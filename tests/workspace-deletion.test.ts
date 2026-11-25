import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { eq, inArray, is, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { totpCode } from "../e2e/support/totp";
import { DEFAULT_WORKFLOW } from "@/lib/workflow";
import { confirmsWorkspace, isRecentSignIn, RECENT_SIGN_IN_MINUTES } from "@/lib/workspace-deletion";
import { reauthWith, REAUTH_MAX_FAILURES } from "@/server/auth/reauth";
import { rollUpUsage } from "@/server/backoffice/rollup";
import { listAuditLog } from "@/server/backoffice";
import type { Db } from "@/server/db/client";
import { migratePgliteClient } from "@/server/db/migrate";
import * as schema from "@/server/db/schema";
import {
  documentBlobs,
  invitation,
  oauthAccessToken,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  organization,
  pushDevices,
  realtimeStreams,
  session,
  toolCallsDaily,
  twoFactor,
  verification,
  workspaceDeletions,
} from "@/server/db/schema";
import { authenticateAgentToken } from "@/server/domain/agents";
import type { Ctx, Tenant } from "@/server/domain/context";
import { saveDigestSubscription } from "@/server/domain/digest";
import { attachDocument } from "@/server/domain/documents";
import { createGoal } from "@/server/domain/goals";
import { remember } from "@/server/domain/memory";
import { muteWorkspace } from "@/server/domain/notifications";
import { sweepPipelines } from "@/server/domain/pipeline-engine";
import { definePipeline, startRun } from "@/server/domain/pipelines";
import { answerInput, captureTasks, requestInput, updateTask } from "@/server/domain/tasks";
import { listMemberships } from "@/server/domain/tenants";
import { registerWebhook } from "@/server/domain/webhooks";
import { saveWorkflow } from "@/server/domain/workflow";
import {
  AGENT_KEYED_TABLES,
  clearPendingWorkspaceBlobs,
  clearWorkspaceBlobs,
  DELETE_ATTEMPTS_PER_ADDRESS,
  deleteWorkspace,
  KEPT_AFTER_DELETION,
  workspaceInventory,
  WORKSPACE_TABLES,
  type BlobStoreFor,
} from "@/server/domain/workspace-deletion";
import type { BlobStore } from "@/server/storage/blobs";
import type { Email } from "@/server/digest/email";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import { ADMIN_EMAIL, seedPlatformAdmin } from "./support/backoffice";
import { addMember, asUser, connectAgent, createTestDb, seedUser, seedWorkspace, type TestDb } from "./support/db";
import { freshProof, tablesWithWorkspaceColumn, trustingReauth, workspaceRows } from "./support/deletion";
import { connectOAuthAgent, createOAuthServer, jsonPost, refresh, OAUTH_RESOURCE, type Connected, type OAuthServer } from "./support/oauth";
import { deviceFor } from "./support/push";

const PASSWORD = "correct-horse-battery";

let shared: TestDb;
let server: OAuthServer;

beforeAll(async () => {
  shared = await createTestDb();
});

beforeEach(() => {
  server = createOAuthServer(shared.db);
  vi.stubEnv("PHEAN_WEBHOOK_ALLOW_PRIVATE", "1");
});

afterEach(() => vi.unstubAllEnvs());

afterAll(() => shared.close());

const initialize = (target: OAuthServer, token: string) =>
  target.handler(
    jsonPost(
      OAUTH_RESOURCE,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
      { accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    ),
  );

interface Filled {
  connected: Connected;
  owner: Ctx;
  tenant: Tenant;
  scout: { ctx: Ctx; token: string; agentId: string };
  member: Ctx;
}

/**
 * A workspace with something in every tenant table: an OAuth agent with tokens and a key agent,
 * goals, tasks, decisions open and answered, a document (bytes in the database store), a memory,
 * a webhook with deliveries, a pipeline mid-run, a device's push deliveries and a member's mute,
 * watches, settings, a digest, an invitation, a realtime stream and usage counts. With `deadlines`,
 * its run waits on a person with a time limit and its pipeline has a schedule, so a sweep would act.
 */
async function filled(db: Db, target: OAuthServer, name: string, { deadlines = false } = {}): Promise<Filled> {
  const connected = await connectOAuthAgent(db, target, name);
  const owner = connected.ctx;
  const { tenant } = connected;
  const scout = await connectAgent(owner, "Scout");
  const lee = await seedUser(db, "Lee");
  await addMember(db, tenant, lee, "member");
  const member = asUser(db, tenant, lee, "member");
  await deviceFor(db, connected.person);
  await muteWorkspace(member, {});

  const goal = await createGoal(owner, { title: `${name} goal` });
  await registerWebhook(scout.ctx, { url: `https://hooks.example.com/${tenant.slug}` });
  const { created } = await captureTasks(scout.ctx, {
    tasks: [
      { title: `${name}: draft the memo`, goalId: goal.id, status: "todo" },
      { title: `${name}: pick a vendor`, status: "todo" },
    ],
  });
  const [memo, vendor] = created as unknown as [{ id: string }, { id: string }];
  await requestInput(scout.ctx, { taskId: memo.id, kind: "decision", question: "Send it?", options: ["Yes", "No"] });
  await answerInput(owner, { taskId: memo.id, answer: "Yes" });
  await requestInput(scout.ctx, { taskId: vendor.id, kind: "question", question: "Which vendor?" });
  await updateTask(owner, { taskId: vendor.id, priority: "high" });
  await attachDocument(scout.ctx, { title: `${name} memo`, taskId: memo.id, content: "# The memo" });
  await remember(scout.ctx, { content: `${name} keeps its books in euros`, kind: "fact" });
  await saveWorkflow(owner, { stages: DEFAULT_WORKFLOW.map((stage) => (stage.key === "inbox" ? { ...stage, label: "Triage" } : stage)) });
  await saveDigestSubscription(owner, { hour: 7, timeZone: "UTC" });

  const review = {
    id: "review",
    name: "Review",
    kind: "person",
    person: owner.actor.id,
    then: { choice: [{ label: "Approve", end: "done" }, { label: "Hold", end: "held" }] },
    ...(deadlines && { timeLimitMinutes: 60, onTimeout: "Hold" }),
  };
  const { pipeline } = await definePipeline(owner, {
    name: `${name} review`,
    definition: { stops: [review], ends: [{ id: "done", name: "Done" }, { id: "held", name: "Held" }], inputs: [] } as never,
    ...(deadlines && { triggers: { schedule: { cron: "15 * * * *", timeZone: "UTC" } } as never }),
  });
  await startRun(owner, { pipelineId: pipeline.id });

  await db.insert(invitation).values({ id: randomUUID(), organizationId: tenant.id, email: `new-${tenant.slug}@example.com`, role: "member", status: "pending", expiresAt: new Date(Date.now() + 86_400_000), inviterId: owner.actor.id });
  await db.insert(realtimeStreams).values({ id: randomUUID(), tenantId: tenant.id, rootAgentId: scout.agentId });
  await db.insert(toolCallsDaily).values({ day: new Date().toISOString().slice(0, 10), tenantId: tenant.id, agentId: scout.agentId, tool: "whoami", calls: 3 });
  // The person's session had this workspace open.
  await db.update(session).set({ activeOrganizationId: tenant.id }).where(eq(session.userId, owner.actor.id));
  return { connected, owner, tenant, scout, member };
}

describe("deleting a workspace", () => {
  it("deletes every row of it in every tenant table, and leaves another workspace exactly as it was", async () => {
    // Its own database, so the sweep below sees only these two workspaces.
    const testDb = await createTestDb();
    try {
      const { db } = testDb;
      const local = createOAuthServer(db);
      vi.stubEnv("PHEAN_WEBHOOK_ALLOW_PRIVATE", "1");
      const acme = await filled(db, local, "acme", { deadlines: true });
      const globex = await filled(db, local, "globex");
      // Stored days end yesterday, so roll up as if two days on: today's events become stored rows.
      await rollUpUsage(db, new Date(Date.now() + 2 * 86_400_000));

      const before = await workspaceRows(db, acme.tenant.id);
      // The fill reaches every table that names a workspace, so "zero rows after" means something.
      for (const { name } of tablesWithWorkspaceColumn()) {
        if (KEPT_AFTER_DELETION.some((table) => getTableConfig(table).name === name)) continue;
        expect(before[name]?.length, `${name} was seeded`).toBeGreaterThan(0);
      }
      expect(await db.select().from(documentBlobs).where(eq(documentBlobs.tenantId, acme.tenant.id))).toHaveLength(1);
      const globexBefore = await workspaceRows(db, globex.tenant.id);
      expect((await initialize(local, acme.connected.accessToken)).status).toBe(200);

      // Better Auth rows keyed by an agent: an access token row and a code not redeemed yet, in both workspaces.
      const agentRows = async (target: Filled) => {
        const code = { id: randomUUID(), identifier: `code-${randomUUID()}`, value: JSON.stringify({ type: "authorization_code", referenceId: target.connected.agentId }), expiresAt: new Date(Date.now() + 600_000) };
        const token = { id: randomUUID(), token: randomUUID(), clientId: target.connected.clientId, userId: target.owner.actor.id, referenceId: target.connected.agentId, expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date(), scopes: ["phean:write"] };
        await db.insert(verification).values(code);
        await db.insert(oauthAccessToken).values(token);
        return { codeId: code.id, tokenId: token.id };
      };
      const acmeRows = await agentRows(acme);
      const globexRows = await agentRows(globex);

      const counts = await workspaceInventory(acme.owner, {});
      // Two captured tasks, the run's and its stop's; the OAuth agent and Scout, not the pipelines agent.
      expect(counts).toEqual({ tasks: 4, goals: 1, decisions: 3, documents: 1, memories: 1, agents: 2, pipelines: 1, webhooks: 1, members: 2 });

      const sent: Email[] = [];
      const deleted = await deleteWorkspace(
        acme.owner,
        { confirm: acme.tenant.name, password: PASSWORD },
        { reauth: reauthWith(local.auth, db), signedInAt: null, send: async (email) => void sent.push(email), baseUrl: "https://phean.test" },
      );
      expect(deleted).toMatchObject({ id: acme.tenant.id, slug: acme.tenant.slug, counts });

      const after = await workspaceRows(db, acme.tenant.id);
      for (const { name } of tablesWithWorkspaceColumn()) {
        if (name === "workspace_deletions") expect(after[name], name).toHaveLength(1);
        else expect(after[name], name).toEqual([]);
      }
      expect(await db.select().from(organization).where(eq(organization.id, acme.tenant.id))).toEqual([]);
      expect(await workspaceRows(db, globex.tenant.id)).toEqual(globexBefore);

      // The record: who, which, how much, and its files gone at once (the database store).
      const [record] = await db.select().from(workspaceDeletions).where(eq(workspaceDeletions.tenantId, acme.tenant.id));
      expect(record).toMatchObject({ name: "acme", slug: acme.tenant.slug, deletedByUserId: acme.owner.actor.id, deletedByEmail: acme.connected.person.email, counts });
      expect(record!.blobsClearedAt).toBeInstanceOf(Date);

      // Agents' credentials outside the tenant tables are gone too, and their tokens stop at once.
      const agentIds = [acme.connected.agentId, acme.scout.agentId];
      expect(await db.select().from(oauthRefreshToken).where(inArray(oauthRefreshToken.referenceId, agentIds))).toEqual([]);
      expect(await db.select().from(oauthConsent).where(inArray(oauthConsent.referenceId, agentIds))).toEqual([]);
      expect(await db.select().from(oauthAccessToken).where(inArray(oauthAccessToken.referenceId, agentIds))).toEqual([]);
      expect(await db.select().from(verification).where(eq(verification.id, acmeRows.codeId))).toEqual([]);
      expect(await db.select().from(oauthAccessToken).where(eq(oauthAccessToken.id, acmeRows.tokenId))).toEqual([]);
      expect(await db.select({ id: verification.id }).from(verification).where(eq(verification.id, globexRows.codeId))).toHaveLength(1);
      expect(await db.select({ id: oauthAccessToken.id }).from(oauthAccessToken).where(eq(oauthAccessToken.id, globexRows.tokenId))).toHaveLength(1);
      expect((await initialize(local, acme.connected.accessToken)).status).toBe(401);
      expect((await initialize(local, acme.scout.token)).status).toBe(401);
      expect(await authenticateAgentToken(db, acme.scout.token)).toBeNull();
      expect((await refresh(local, acme.connected.clientId, acme.connected.refreshToken)).ok).toBe(false);
      expect((await initialize(local, globex.connected.accessToken)).status).toBe(200);
      expect((await initialize(local, globex.scout.token)).status).toBe(200);

      // People keep their accounts and devices; their sessions just forget the workspace.
      expect(await listMemberships(db, acme.owner.actor.id)).toEqual([]);
      expect(await db.select({ id: pushDevices.id }).from(pushDevices).where(eq(pushDevices.userId, acme.owner.actor.id))).toHaveLength(1);
      const sessions = await db.select({ active: session.activeOrganizationId }).from(session).where(eq(session.userId, acme.owner.actor.id));
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((row) => row.active === null)).toBe(true);

      // The run that waited on a person, with a time limit, and the schedule: nothing left to sweep.
      const later = new Date(Date.now() + 3 * 60 * 60_000);
      expect(await sweepPipelines(db, later)).toEqual({ reminded: 0, timedOut: 0, started: 0, resent: 0, gaveUp: 0 });
      expect(await workspaceRows(db, globex.tenant.id)).toEqual(globexBefore);

      // The other member is told; nothing in the mail comes from inside the workspace.
      expect(sent.map((email) => email.to)).toEqual([expect.stringMatching(/^lee\./)]);
      expect(sent[0]!.subject).toBe("acme was deleted");
      expect(sent[0]!.text).not.toContain("draft the memo");
    } finally {
      vi.unstubAllEnvs();
      await testDb.close();
    }
  });

  it("covers every table that names a workspace: a new tenant table must be added to the deletion", () => {
    const covered = new Set(WORKSPACE_TABLES.map(({ table }) => getTableConfig(table).name));
    const kept = new Set(KEPT_AFTER_DELETION.map((table) => getTableConfig(table).name));
    for (const { name, column } of tablesWithWorkspaceColumn()) {
      expect(covered.has(name) || kept.has(name), `${name} has ${column} but is not in WORKSPACE_TABLES or KEPT_AFTER_DELETION`).toBe(true);
    }
    for (const { table, column } of WORKSPACE_TABLES) {
      expect(["tenant_id", "organization_id"], getTableConfig(table).name).toContain(column.name);
    }
    // The deletion's own record is never in the list it empties.
    for (const name of kept) expect(covered.has(name), name).toBe(false);
  });

  it("knows every table in the schema: a new table must say whether a workspace owns its rows", () => {
    const names = (tables: readonly PgTable[]) => new Set(tables.map((table) => getTableConfig(table).name));
    const covered = names(WORKSPACE_TABLES.map(({ table }) => table));
    const kept = names(KEPT_AFTER_DELETION);
    const agentKeyed = names(AGENT_KEYED_TABLES);
    /**
     * Every other table, and why the lists above leave it out. A table that appears in the schema in none
     * of these lists fails here, whatever its columns are called.
     */
    const OTHER_TABLES: Record<string, string> = {
      organization: "the workspace itself, deleted last, by id",
      user: "a person, who may be in other workspaces",
      session: "a person's; its active workspace is cleared",
      account: "a person's sign-in methods",
      verification: "short-lived tokens; agents' pending codes are deleted by agent id",
      two_factor: "a person's second factor",
      rate_limit: "counters by address or person",
      jwks: "the server's signing keys",
      oauth_client: "registered clients, shared by every workspace; pruned when unused (`reference_id` is unused: create-client is off)",
      oauth_resource: "MCP URLs; a workspace's own is deleted by its slug",
      oauth_client_resource: "goes with its client or resource",
      oauth_client_assertion: "replay guard for client assertions",
      push_devices: "a person's devices; they stop hearing about the workspace once its mutes and deliveries go",
      usage_rollup_state: "one row of rollup progress",
    };
    const all = (Object.values(schema) as unknown[]).filter((value): value is PgTable => is(value, PgTable)).map((table) => getTableConfig(table));
    for (const config of all) {
      const known = covered.has(config.name) || kept.has(config.name) || agentKeyed.has(config.name) || config.name in OTHER_TABLES;
      expect(known, `${config.name} is new: add it to WORKSPACE_TABLES, KEPT_AFTER_DELETION or AGENT_KEYED_TABLES, or say here why a workspace does not own its rows`).toBe(true);
      // A column that names a workspace or an agent is a sign the table belongs with the deletion.
      const columns = config.columns.map((column) => column.name);
      const naming = columns.filter((column) => ["tenant_id", "organization_id", "workspace_id"].includes(column) || column === "agent_id" || column.endsWith("_agent_id"));
      if (naming.length) expect(covered.has(config.name) || kept.has(config.name), `${config.name} has ${naming.join(", ")}`).toBe(true);
      if (columns.includes("reference_id")) expect(agentKeyed.has(config.name) || config.name === "oauth_client", `${config.name} has reference_id`).toBe(true);
    }
  });

  it("removes the workspace's own MCP resource and leaves the shared one", async () => {
    const acme = await seedWorkspace(shared.db);
    const resource = (path: string) => ({ id: randomUUID(), identifier: `http://localhost:3200${path}`, name: path, createdAt: new Date(), updatedAt: new Date() });
    await shared.db.insert(oauthResource).values([resource(`/mcp/w/${acme.tenant.slug}`), resource(`/mcp/w/x-${acme.tenant.slug}`)]).onConflictDoNothing();
    await deleteWorkspace(acme.human, { confirm: acme.tenant.slug }, freshProof());
    const left = (await shared.db.select({ identifier: oauthResource.identifier }).from(oauthResource)).map((row) => row.identifier);
    expect(left).not.toContain(`http://localhost:3200/mcp/w/${acme.tenant.slug}`);
    expect(left).toContain(`http://localhost:3200/mcp/w/x-${acme.tenant.slug}`);
  });

  it("shows the deletion in the backoffice's audit page, with no customer content", async () => {
    vi.stubEnv("PHEAN_PLATFORM_ADMINS", ADMIN_EMAIL);
    vi.stubEnv("PHEAN_ADMIN_REQUIRE_2FA", "0");
    const admin = await seedPlatformAdmin(shared.db);
    const acme = await seedWorkspace(shared.db, { name: "Initech" });
    await captureTasks(acme.human, { tasks: [{ title: "Top secret roadmap" }] });
    await deleteWorkspace(acme.human, { confirm: "Initech" }, freshProof());
    const log = await listAuditLog(admin, {});
    const row = log.deletions.find((entry) => entry.tenantId === acme.tenant.id);
    expect(row).toMatchObject({ name: "Initech", slug: acme.tenant.slug, counts: expect.objectContaining({ tasks: 1 }) });
    expect(JSON.stringify(log)).not.toContain("Top secret roadmap");
  });
});

describe("who may delete a workspace, and how they prove it", () => {
  it("asks for the exact name or slug", async () => {
    const acme = await seedWorkspace(shared.db, { name: "Acme Corp" });
    for (const confirm of ["", "acme corp", "Acme", "Acme Corp.", `${acme.tenant.slug}x`]) {
      await expect(deleteWorkspace(acme.human, { confirm }, freshProof())).rejects.toMatchObject({ code: "invalid" });
    }
    expect(confirmsWorkspace("  Acme Corp ", acme.tenant)).toBe(true);
    expect(confirmsWorkspace(acme.tenant.slug, acme.tenant)).toBe(true);
    expect(await shared.db.select().from(organization).where(eq(organization.id, acme.tenant.id))).toHaveLength(1);
  });

  it("checks the owner's password on the server, and locks after too many wrong ones", async () => {
    const acme = await connectOAuthAgent(shared.db, server, "acme");
    const reauth = reauthWith(server.auth, shared.db);
    const proof = { reauth, signedInAt: new Date() };
    await expect(deleteWorkspace(acme.ctx, { confirm: "acme" }, proof)).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("password") });
    for (let attempt = 0; attempt < REAUTH_MAX_FAILURES; attempt += 1) {
      await expect(deleteWorkspace(acme.ctx, { confirm: "acme", password: "wrong-horse-battery" }, proof)).rejects.toMatchObject({ code: "forbidden", message: "That password is not right." });
    }
    // Locked now: even the right password waits.
    await expect(deleteWorkspace(acme.ctx, { confirm: "acme", password: PASSWORD }, proof)).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("Too many") });
    expect(await shared.db.select().from(organization).where(eq(organization.id, acme.tenant.id))).toHaveLength(1);
    expect((await initialize(server, acme.accessToken)).status).toBe(200);
  });

  it("asks for a two-factor code when two-factor is on, and checks it", async () => {
    const acme = await connectOAuthAgent(shared.db, server, "acme");
    const enabled = await server.auth.handler(jsonPost(`${server.baseUrl}/api/auth/two-factor/enable`, { password: PASSWORD }, { cookie: acme.cookie, origin: server.baseUrl }));
    expect(enabled.status).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await server.auth.handler(jsonPost(`${server.baseUrl}/api/auth/two-factor/verify-totp`, { code: totpCode(totpURI) }, { cookie: acme.cookie, origin: server.baseUrl }));
    expect(verified.status).toBe(200);

    const proof = { reauth: reauthWith(server.auth, shared.db), signedInAt: new Date() };
    await expect(deleteWorkspace(acme.ctx, { confirm: "acme", password: PASSWORD }, proof)).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("6-digit code") });
    const wrong = String((Number(totpCode(totpURI)) + 500_000) % 1_000_000).padStart(6, "0");
    await expect(deleteWorkspace(acme.ctx, { confirm: "acme", password: PASSWORD, code: wrong }, proof)).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteWorkspace(acme.ctx, { confirm: "acme", password: "wrong-horse-battery", code: totpCode(totpURI) }, proof)).rejects.toMatchObject({ code: "forbidden" });
    expect(await shared.db.select().from(organization).where(eq(organization.id, acme.tenant.id))).toHaveLength(1);

    await expect(deleteWorkspace(acme.ctx, { confirm: "acme", password: PASSWORD, code: totpCode(totpURI) }, proof)).resolves.toMatchObject({ id: acme.tenant.id });
    expect(await shared.db.select().from(organization).where(eq(organization.id, acme.tenant.id))).toEqual([]);
  });

  it("asks someone without a password for a recent sign-in instead", async () => {
    const acme = await seedWorkspace(shared.db);
    const proof = (minutesAgo: number) => ({ reauth: reauthWith(server.auth, shared.db), signedInAt: new Date(Date.now() - minutesAgo * 60_000) });
    await expect(deleteWorkspace(acme.human, { confirm: acme.tenant.name }, proof(RECENT_SIGN_IN_MINUTES + 1))).rejects.toMatchObject({ code: "forbidden", message: expect.stringContaining("sign in again") });
    expect(isRecentSignIn(new Date(Date.now() - 60_000), new Date())).toBe(true);
    await expect(deleteWorkspace(acme.human, { confirm: acme.tenant.name }, proof(1))).resolves.toMatchObject({ id: acme.tenant.id });
  });

  it("counts password attempts before checking them, so attempts made at once cannot get past the limit", async () => {
    const acme = await connectOAuthAgent(shared.db, server, "acme");
    const proof = { reauth: reauthWith(server.auth, shared.db), signedInAt: new Date() };
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => deleteWorkspace(acme.ctx, { confirm: "acme", password: "wrong-horse-battery" }, proof)));
    const reasons = attempts.map((attempt) => (attempt.status === "rejected" ? (attempt.reason as Error).message : "deleted"));
    expect(reasons.filter((reason) => reason === "That password is not right.").length).toBeLessThanOrEqual(REAUTH_MAX_FAILURES);
    expect(reasons.filter((reason) => reason.startsWith("Too many")).length).toBeGreaterThanOrEqual(12 - REAUTH_MAX_FAILURES);
    await expect(deleteWorkspace(acme.ctx, { confirm: "acme", password: PASSWORD }, proof)).rejects.toMatchObject({ message: expect.stringContaining("Too many") });
    expect(await shared.db.select().from(organization).where(eq(organization.id, acme.tenant.id))).toHaveLength(1);
  });

  it("limits delete attempts per client address, whoever is signed in", async () => {
    const address = `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;
    const acme = await seedWorkspace(shared.db);
    for (let attempt = 0; attempt < DELETE_ATTEMPTS_PER_ADDRESS.max; attempt += 1) {
      await expect(deleteWorkspace(acme.human, { confirm: "not it" }, freshProof(trustingReauth, { clientAddress: address }))).rejects.toMatchObject({ code: "invalid" });
    }
    const other = await seedWorkspace(shared.db);
    await expect(deleteWorkspace(other.human, { confirm: other.tenant.name }, freshProof(trustingReauth, { clientAddress: address }))).rejects.toMatchObject({
      code: "forbidden",
      message: expect.stringContaining("Too many attempts"),
    });
    await expect(deleteWorkspace(other.human, { confirm: other.tenant.name }, freshProof(trustingReauth, { clientAddress: `${address}-elsewhere` }))).resolves.toMatchObject({ id: other.tenant.id });
  });

  it("takes an authenticator code once, starts the count afresh when a lock runs out, and takes a backup code through the plugin", async () => {
    const acme = await connectOAuthAgent(shared.db, server, "acme");
    const { uri, backupCodes, cookie } = await withTwoFactor(acme);
    const userId = acme.person.id;
    const reauth = reauthWith(server.auth, shared.db, { headers: new Headers({ cookie, origin: server.baseUrl }) });

    // The next step's code: the one the enabling step used is already spent.
    const code = totpCode(uri, { stepOffset: 1 });
    expect(await reauth.verifySecondFactor(userId, code)).toBe(true);
    expect(await reauth.verifySecondFactor(userId, code)).toBe(false);

    // A lock that ran out: the next wrong code is the first of a new count, not the tenth.
    await shared.db.update(twoFactor).set({ failedVerificationCount: 9, lockedUntil: new Date(Date.now() - 1000) }).where(eq(twoFactor.userId, userId));
    expect(await reauth.verifySecondFactor(userId, "000000" === code ? "111111" : "000000")).toBe(false);
    const [row] = await shared.db.select({ failures: twoFactor.failedVerificationCount, lockedUntil: twoFactor.lockedUntil }).from(twoFactor).where(eq(twoFactor.userId, userId));
    expect(row).toEqual({ failures: 1, lockedUntil: null });

    // A backup code works once, through the plugin; without the person's session it is refused.
    expect(await reauthWith(server.auth, shared.db).verifySecondFactor(userId, backupCodes[0]!)).toBe(false);
    expect(await reauth.verifySecondFactor(userId, backupCodes[0]!)).toBe(true);
    expect(await reauth.verifySecondFactor(userId, backupCodes[0]!)).toBe(false);
    await expect(deleteWorkspace(acme.ctx, { confirm: "acme", password: PASSWORD, code: backupCodes[1]! }, { reauth, signedInAt: null })).resolves.toMatchObject({ id: acme.tenant.id });
  });

  it("locks the owner's membership row while it deletes", async () => {
    const client = new PGlite();
    await migratePgliteClient(client);
    const queries: string[] = [];
    const db = drizzle(client, { schema, logger: { logQuery: (query) => void queries.push(query) } }) as unknown as Db;
    try {
      const acme = await seedWorkspace(db);
      await deleteWorkspace(acme.human, { confirm: acme.tenant.name }, freshProof());
      expect(queries.some((query) => /from "member".* for update of "member"/is.test(query))).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("refuses Better Auth's own organization delete endpoint, which would skip all of this", async () => {
    const acme = await connectOAuthAgent(shared.db, server, "acme");
    const response = await server.auth.handler(jsonPost(`${server.baseUrl}/api/auth/organization/delete`, { organizationId: acme.tenant.id }, { cookie: acme.cookie, origin: server.baseUrl }));
    expect(response.ok).toBe(false);
    expect(await shared.db.select().from(organization).where(eq(organization.id, acme.tenant.id))).toHaveLength(1);
  });
});


/** Turns two-factor on for a connected owner through the real endpoints; returns the session cookie after the plugin rotates it. */
async function withTwoFactor(acme: Connected): Promise<{ uri: string; backupCodes: string[]; cookie: string }> {
  const enabled = await server.auth.handler(jsonPost(`${server.baseUrl}/api/auth/two-factor/enable`, { password: PASSWORD }, { cookie: acme.cookie, origin: server.baseUrl }));
  expect(enabled.status).toBe(200);
  const { totpURI: uri, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
  const verified = await server.auth.handler(jsonPost(`${server.baseUrl}/api/auth/two-factor/verify-totp`, { code: totpCode(uri) }, { cookie: acme.cookie, origin: server.baseUrl }));
  expect(verified.status).toBe(200);
  const jar = new Map(acme.cookie.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)] as const));
  for (const line of verified.headers.getSetCookie()) {
    const pair = line.split(";")[0]!;
    jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
  }
  return { uri, backupCodes, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}

describe("migration 0024", () => {
  it("runs again over its own table, column and index, as a preview sharing the database may have run it first", async () => {
    const statements = readFileSync(new URL("../drizzle/0024_workspace_deletions.sql", import.meta.url), "utf8").split("--> statement-breakpoint");
    for (const statement of statements) await shared.db.execute(sql.raw(statement));
    const acme = await seedWorkspace(shared.db);
    await expect(deleteWorkspace(acme.human, { confirm: acme.tenant.name }, freshProof())).resolves.toMatchObject({ id: acme.tenant.id });
  });
});

describe("deleting a deleted workspace's files", () => {
  /** A store that remembers what it was asked to delete, and fails for the tenants in `failing`. */
  function fakeStores(failing: Set<string>) {
    const deleted: string[] = [];
    const storeFor: BlobStoreFor = (_db, tenantId) =>
      ({
        driver: "vercel-blob",
        put: async () => undefined,
        get: async () => null,
        delete: async () => undefined,
        deletePrefix: async (prefix: string) => {
          if (failing.has(tenantId)) throw new Error("the store is down");
          deleted.push(prefix);
        },
      }) satisfies BlobStore;
    return { deleted, storeFor };
  }

  const pending = async (db: Db, tenantId: string, attemptedAt: Date | null) => {
    const [row] = await db
      .insert(workspaceDeletions)
      .values({ tenantId, name: "Gone", slug: "gone", deletedByUserId: "u", deletedByEmail: "u@example.com", deletedByName: "U", counts: {}, blobsAttemptedAt: attemptedAt })
      .returning({ id: workspaceDeletions.id });
    return row!.id;
  };
  const rowOf = async (db: Db, id: number) => (await db.select().from(workspaceDeletions).where(eq(workspaceDeletions.id, id)))[0]!;

  it("deletes by the tenant's prefix, notes each try, and leaves a failure for the tick", async () => {
    const testDb = await createTestDb();
    try {
      const failing = new Set(["t-down"]);
      const { deleted, storeFor } = fakeStores(failing);
      const down = await pending(testDb.db, "t-down", null);
      expect(await clearWorkspaceBlobs(testDb.db, "t-down", down, storeFor)).toBe(false);
      expect(await rowOf(testDb.db, down)).toMatchObject({ blobsClearedAt: null, blobsAttemptedAt: expect.any(Date) });

      failing.clear();
      expect(await clearWorkspaceBlobs(testDb.db, "t-down", down, storeFor)).toBe(true);
      expect(deleted).toEqual(["tenants/t-down/"]);
      expect((await rowOf(testDb.db, down)).blobsClearedAt).toBeInstanceOf(Date);
    } finally {
      await testDb.close();
    }
  });

  it("retries the least recently tried first, so one that keeps failing cannot starve the rest", async () => {
    const testDb = await createTestDb();
    try {
      const { deleted, storeFor } = fakeStores(new Set(["t-stuck"]));
      // The older row was just tried and keeps failing; the newer one was never tried.
      const stuck = await pending(testDb.db, "t-stuck", new Date());
      const waiting = await pending(testDb.db, "t-waiting", null);
      expect(stuck).toBeLessThan(waiting);
      expect(await clearPendingWorkspaceBlobs(testDb.db, { limit: 1, storeFor })).toBe(1);
      expect(deleted).toEqual(["tenants/t-waiting/"]);
      expect((await rowOf(testDb.db, waiting)).blobsClearedAt).toBeInstanceOf(Date);
      // Next tick: only the stuck one is left; it is tried, fails, and stays.
      expect(await clearPendingWorkspaceBlobs(testDb.db, { limit: 1, storeFor })).toBe(0);
      expect((await rowOf(testDb.db, stuck)).blobsClearedAt).toBeNull();
    } finally {
      await testDb.close();
    }
  });
});
