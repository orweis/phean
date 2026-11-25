import { and, asc, count, eq, inArray, isNull, like, ne, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";

import { routes } from "@/lib/routes";
import { confirmsWorkspace, isRecentSignIn, RECENT_SIGN_IN_MINUTES, type DeletionCounts } from "@/lib/workspace-deletion";

import type { Db } from "../db/client";
import {
  agents,
  backofficeAudit,
  digestSubscriptions,
  documentBlobs,
  documents,
  events,
  goals,
  invitation,
  member,
  memories,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  organization,
  pipelineRunStops,
  pipelineRuns,
  pipelines,
  pipelineTriggers,
  pipelineVersions,
  pushDeliveries,
  pushMutes,
  realtimeStreams,
  session,
  tasks,
  toolCallsDaily,
  usageDaily,
  user,
  verification,
  watches,
  webhookDeliveries,
  webhooks,
  workspaceDeletions,
  workspaceSettings,
} from "../db/schema";
import type { Email, SendEmail } from "../digest/email";
import { renderWorkspaceDeletedEmail } from "../digest/workspace-deleted";
import { withinRateLimit } from "../rate-limit";
import { blobStore, tenantKeyPrefix, type BlobStore } from "../storage/blobs";
import { inTenant, inTransaction, onCommit, type Ctx } from "./context";
import { forbidden, invalid, notFound } from "./errors";
import { assertCan } from "./policy";
import { DeleteWorkspaceInput, Empty } from "./schemas";
import { parseInput, service } from "./service";

/**
 * Every table that holds a workspace's rows, by the column that names the workspace, in the order
 * the deletion empties them: what refers to a row goes before the row. Most would also go by
 * cascade from `organization`, but the deletion names each one rather than lean on the foreign keys.
 * A new tenant table must be added here; `tests/workspace-deletion.test.ts` reads the schema and
 * fails for any table with a `tenant_id` or `organization_id` column that is neither here nor in
 * `KEPT_AFTER_DELETION`.
 */
export const WORKSPACE_TABLES: readonly { table: PgTable; column: PgColumn }[] = [
  { table: pushDeliveries, column: pushDeliveries.tenantId },
  { table: webhookDeliveries, column: webhookDeliveries.tenantId },
  { table: webhooks, column: webhooks.tenantId },
  { table: watches, column: watches.tenantId },
  { table: realtimeStreams, column: realtimeStreams.tenantId },
  { table: pipelineRunStops, column: pipelineRunStops.tenantId },
  { table: pipelineRuns, column: pipelineRuns.tenantId },
  { table: pipelineTriggers, column: pipelineTriggers.tenantId },
  { table: pipelineVersions, column: pipelineVersions.tenantId },
  { table: pipelines, column: pipelines.tenantId },
  { table: memories, column: memories.tenantId },
  { table: documents, column: documents.tenantId },
  { table: documentBlobs, column: documentBlobs.tenantId },
  { table: tasks, column: tasks.tenantId },
  { table: goals, column: goals.tenantId },
  { table: events, column: events.tenantId },
  { table: agents, column: agents.tenantId },
  { table: pushMutes, column: pushMutes.tenantId },
  { table: digestSubscriptions, column: digestSubscriptions.tenantId },
  { table: workspaceSettings, column: workspaceSettings.tenantId },
  { table: usageDaily, column: usageDaily.tenantId },
  { table: toolCallsDaily, column: toolCallsDaily.tenantId },
  { table: invitation, column: invitation.organizationId },
  { table: member, column: member.organizationId },
];

/**
 * Phean's own records about a workspace, which outlive it on purpose and hold no customer content:
 * the backoffice's audit trail and the deletion record itself.
 */
export const KEPT_AFTER_DELETION: readonly PgTable[] = [backofficeAudit, workspaceDeletions];

/**
 * Better Auth's OAuth rows that belong to one of the workspace's agents: their `reference_id` is the
 * agent's id (the consent's `consentReferenceId`, carried onto the tokens). Deleted by agent id, with
 * the authorization codes still waiting in `verification`. The test fails for a new table with a
 * `reference_id` that is neither here nor explained in its list of tables that are not the workspace's.
 */
export const AGENT_KEYED_TABLES = [oauthAccessToken, oauthRefreshToken, oauthConsent] as const;

/** How many of each thing the workspace holds: the Danger zone's list, and the deletion record's. */
async function countWorkspace(ctx: Ctx): Promise<DeletionCounts> {
  const tally = async (table: PgTable & { tenantId: PgColumn }, where?: ReturnType<typeof eq>) => {
    const [row] = await ctx.db
      .select({ n: count() })
      .from(table)
      .where(and(inTenant(ctx, table), where));
    return row?.n ?? 0;
  };
  const [decisionRow] = await ctx.db
    .select({ n: sql<number>`coalesce(sum(jsonb_array_length(${tasks.inputAnswers}) + (${tasks.inputRequest} is not null)::int), 0)`.mapWith(Number) })
    .from(tasks)
    .where(inTenant(ctx, tasks));
  const [memberRow] = await ctx.db.select({ n: count() }).from(member).where(eq(member.organizationId, ctx.tenant.id));
  const [taskCount, goalCount, documentCount, memoryCount, agentCount, pipelineCount, webhookCount] = await Promise.all([
    tally(tasks),
    tally(goals),
    tally(documents),
    tally(memories),
    // The pipelines agent is Phean's own and never listed, so it is not counted either.
    tally(agents, ne(agents.authKind, "system")),
    tally(pipelines),
    tally(webhooks),
  ]);
  return {
    tasks: taskCount,
    goals: goalCount,
    decisions: decisionRow?.n ?? 0,
    documents: documentCount,
    memories: memoryCount,
    agents: agentCount,
    pipelines: pipelineCount,
    webhooks: webhookCount,
    members: memberRow?.n ?? 0,
  };
}

/** What deleting the workspace would delete, for its owner's Danger zone. */
export const workspaceInventory = service(Empty, async (ctx): Promise<DeletionCounts> => {
  assertCan(ctx, "workspace:delete");
  return countWorkspace(ctx);
});

/**
 * Checks a person's sign-in factors again, server-side. Built from Better Auth's own context in
 * production (`reauthWith` in `server/auth/reauth.ts`); a wrong answer counts toward a lockout.
 */
export interface Reauth {
  /** What this person signs in with: whether they have a password, and whether two-factor is on. */
  factors(userId: string): Promise<{ password: boolean; twoFactor: boolean }>;
  /** Whether this is their password. Throws a forbidden error while too many wrong ones lock it. */
  verifyPassword(userId: string, password: string): Promise<boolean>;
  /**
   * Whether this is a two-factor code of theirs: the authenticator's current code (each accepted once),
   * or one of their backup codes (used up). Throws while two-factor is locked.
   */
  verifySecondFactor(userId: string, code: string): Promise<boolean>;
}

/** Delete attempts one client address may make in a window, whoever is signed in: the brake on guessing across accounts. */
export const DELETE_ATTEMPTS_PER_ADDRESS = { window: 10 * 60, max: 10 };

/** What only the adapter knows, never the form: how to check the person's factors, and their session. */
export interface DeletionProof {
  reauth: Reauth;
  /**
   * When the person last signed in, as the session records it (`session.signedInAt`, carried over
   * from the parent session on rotation and the desktop handoff, never the session's own creation):
   * the proof for people without a password. Null when unknown.
   */
  signedInAt: Date | null;
  /** The request's client address, for `DELETE_ATTEMPTS_PER_ADDRESS`. */
  clientAddress?: string;
  /** Emails the other members, when this deployment sends email. */
  send?: SendEmail | null;
  baseUrl?: string;
  now?: Date;
}

export interface DeletedWorkspace {
  id: string;
  name: string;
  slug: string;
  counts: DeletionCounts;
}

/** Each proof the person's account asks for, in turn; every refusal says what to fix and nothing else. */
async function assertReauthenticated(ctx: Ctx, input: z.output<typeof DeleteWorkspaceInput>, proof: DeletionProof): Promise<void> {
  if (!confirmsWorkspace(input.confirm, ctx.tenant)) {
    throw invalid(`Type the workspace's name, ${ctx.tenant.name}, exactly to confirm.`);
  }
  const { password, twoFactor } = await proof.reauth.factors(ctx.actor.id);
  if (password) {
    if (!input.password) throw invalid("Enter your password to confirm it is you.");
    if (!(await proof.reauth.verifyPassword(ctx.actor.id, input.password))) throw forbidden("That password is not right.");
  } else {
    if (!proof.signedInAt || !isRecentSignIn(proof.signedInAt, proof.now ?? new Date())) {
      throw forbidden(`Sign out and sign in again to confirm it is you, then delete within ${RECENT_SIGN_IN_MINUTES} minutes.`);
    }
  }
  if (twoFactor) {
    if (!input.code) throw invalid("Enter the 6-digit code from your authenticator app, or a backup code.");
    if (!(await proof.reauth.verifySecondFactor(ctx.actor.id, input.code))) {
      throw forbidden("That code is not right. Codes change every 30 seconds, and each works once.");
    }
  }
}

/** Better Auth's authorization codes still waiting for one of these agents (rows of `verification` whose JSON names it). */
function pendingCodesFor(agentIds: readonly string[]) {
  return inArray(sql`(case when ${verification.value} like '{"type":"authorization_code"%' then ${verification.value}::jsonb ->> 'referenceId' end)`, [...agentIds]);
}

/**
 * Deletes a workspace and everything in it, for good. Only its owner, a person, with the workspace's
 * name typed and their sign-in proven again (`assertReauthenticated`). In one transaction: the
 * deletion is recorded (`workspace_deletions`), its agents' OAuth tokens, consents and pending codes
 * go, so their tokens stop at once; sessions that had it active forget it; then every table in
 * `WORKSPACE_TABLES` is emptied of it, and the organization row last. After commit, its files leave
 * the blob store (when that is outside the database), and the other members are emailed.
 */
export const deleteWorkspace = Object.assign(
  async (ctx: Ctx, rawInput: z.input<typeof DeleteWorkspaceInput>, proof: DeletionProof): Promise<DeletedWorkspace> => {
    const input = parseInput(DeleteWorkspaceInput, rawInput);
    assertCan(ctx, "workspace:delete");
    // The matrix keeps it from every agent level already; this says so for any role added later.
    if (ctx.actor.type !== "user") throw forbidden("Only the workspace's owner can delete it, in the Phean web app.");
    if (proof.clientAddress && !(await withinRateLimit(ctx.db, `workspace-delete:${proof.clientAddress}`, DELETE_ATTEMPTS_PER_ADDRESS))) {
      throw forbidden("Too many attempts to delete a workspace from here. Try again in a few minutes.");
    }
    await assertReauthenticated(ctx, input, proof);

    const deleted = await inTransaction(ctx, async (tx) => {
      const [workspace] = await tx.db
        .select({ id: organization.id, name: organization.name, slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, tx.tenant.id))
        .for("update");
      if (!workspace) throw notFound("workspace", tx.tenant.slug);
      // Roles can change between the page and the click: read the membership again, under the lock.
      const [owner] = await tx.db
        .select({ email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.organizationId, workspace.id), eq(member.userId, tx.actor.id), eq(member.role, "owner")))
        .for("update", { of: member });
      if (!owner) throw forbidden("Only the workspace's owner can delete it.");

      const counts = await countWorkspace(tx);
      const others = await tx.db
        .select({ email: user.email, name: user.name })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.organizationId, workspace.id), ne(member.userId, tx.actor.id)));
      const store = blobStore(tx);
      const [record] = await tx.db
        .insert(workspaceDeletions)
        .values({
          tenantId: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          deletedByUserId: tx.actor.id,
          deletedByEmail: owner.email,
          deletedByName: tx.actor.name,
          counts,
          // In the database, the bytes go with the rows below.
          blobsClearedAt: store.driver === "database" ? new Date() : null,
        })
        .returning({ id: workspaceDeletions.id });

      // Agents' credentials outside the tenant tables: refresh and access tokens, consents, and
      // codes not redeemed yet. Access tokens stop anyway, since /mcp reads the agent's row.
      const agentIds = (await tx.db.select({ id: agents.id }).from(agents).where(inTenant(tx, agents))).map((row) => row.id);
      if (agentIds.length) {
        for (const table of AGENT_KEYED_TABLES) await tx.db.delete(table).where(inArray(table.referenceId, agentIds));
        await tx.db.delete(verification).where(pendingCodesFor(agentIds));
      }
      // The workspace's own MCP URL, registered as a resource the first time a client asked for it.
      await tx.db.delete(oauthResource).where(like(oauthResource.identifier, `%${routes.mcp(workspace.slug)}`));
      // Members' sessions stay signed in; they just no longer have it open.
      await tx.db.update(session).set({ activeOrganizationId: null }).where(eq(session.activeOrganizationId, workspace.id));

      for (const { table, column } of WORKSPACE_TABLES) await tx.db.delete(table).where(eq(column, workspace.id));
      await tx.db.delete(organization).where(eq(organization.id, workspace.id));

      if (store.driver !== "database") {
        onCommit(tx, (db) => void clearWorkspaceBlobs(db, workspace.id, record!.id));
      }
      if (proof.send && others.length) {
        const send = proof.send;
        const emails = others.map((other) => renderWorkspaceDeletedEmail({ to: other.email, workspace: workspace.name, deletedBy: tx.actor.name, baseUrl: proof.baseUrl ?? "" }));
        onCommit(tx, () => void notifyMembers(send, emails));
      }
      return { ...workspace, counts };
    });
    return deleted;
  },
  { schema: DeleteWorkspaceInput },
);

/** Which store a deleted workspace's files are in; tests hand in a fake. */
export type BlobStoreFor = (db: Db, tenantId: string) => BlobStore;
const defaultStoreFor: BlobStoreFor = (db, tenantId) => blobStore({ db, tenant: { id: tenantId } });

/**
 * Deletes a deleted workspace's files from the blob store and notes it done. Every try is noted
 * (`blobs_attempted_at`), so the tick retries the longest-waiting first; on failure it stays for it.
 */
export async function clearWorkspaceBlobs(db: Db, tenantId: string, deletionId: number, storeFor: BlobStoreFor = defaultStoreFor): Promise<boolean> {
  try {
    await db.update(workspaceDeletions).set({ blobsAttemptedAt: new Date() }).where(eq(workspaceDeletions.id, deletionId));
    await storeFor(db, tenantId).deletePrefix(tenantKeyPrefix(tenantId));
    await db.update(workspaceDeletions).set({ blobsClearedAt: new Date() }).where(eq(workspaceDeletions.id, deletionId));
    return true;
  } catch (error) {
    console.error(`Could not delete the files of deleted workspace ${tenantId}; the pipelines tick retries.`, error);
    return false;
  }
}

/**
 * The pipelines tick: retries the files of deleted workspaces that the deletion could not clear, the
 * least recently tried first (never tried before anything), so one that keeps failing cannot hold
 * back the ones after it.
 */
export async function clearPendingWorkspaceBlobs(db: Db, { limit = 5, storeFor = defaultStoreFor }: { limit?: number; storeFor?: BlobStoreFor } = {}): Promise<number> {
  const pending = await db
    .select({ id: workspaceDeletions.id, tenantId: workspaceDeletions.tenantId })
    .from(workspaceDeletions)
    .where(isNull(workspaceDeletions.blobsClearedAt))
    .orderBy(sql`${workspaceDeletions.blobsAttemptedAt} asc nulls first`, asc(workspaceDeletions.id))
    .limit(limit);
  let cleared = 0;
  for (const row of pending) if (await clearWorkspaceBlobs(db, row.tenantId, row.id, storeFor)) cleared += 1;
  return cleared;
}

/** Best effort: the workspace is gone whether or not the mail goes out. */
async function notifyMembers(send: SendEmail, emails: readonly Email[]): Promise<void> {
  for (const email of emails) {
    await send(email).catch((error: unknown) => console.error("Could not email a member about a deleted workspace", error));
  }
}
