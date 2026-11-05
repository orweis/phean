import { createHash, randomBytes } from "node:crypto";

import { and, asc, count, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { addDays } from "@/lib/dates";
import { ACCESS_LEVEL_META, AGENT_TOKEN_PREFIX, grantableLevels, highestGrantableLevel, LIMITS, lowerLevel, toMemberRole, type AgentAccessLevel } from "@/lib/domain";

import type { Db } from "../db/client";
import { publicColumns } from "../db/columns";
import { newId } from "../db/ids";
import { agents, member, oauthRefreshToken, organization, user, type AgentRow } from "../db/schema";
import { liveAgent } from "./agent-liveness";
import { agentRole, inTenant, inTransaction, type Ctx, type Tenant } from "./context";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { recordEvent } from "./events";
import { assertCan, can } from "./policy";
import { AgentRefInput, ApproveAgentInput, CreateAgentInput, CreateSubagentInput, Empty } from "./schemas";
import { service } from "./service";
import { disableWebhooksOf } from "./webhooks";

export type Agent = Omit<AgentRow, "tenantId" | "tokenHash">;

const agentColumns = publicColumns(agents, ["tenantId", "tokenHash"]);
const LAST_SEEN_RESOLUTION = sql`interval '1 minute'`;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateAgentToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashToken(token), tokenPrefix: token.slice(0, AGENT_TOKEN_PREFIX.length + 6) };
}

export const listAgents = service(Empty, async (ctx): Promise<Agent[]> => {
  assertCan(ctx, "workspace:read");
  return ctx.db
    .select(agentColumns)
    .from(agents)
    .where(inTenant(ctx, agents))
    .orderBy(asc(agents.createdAt));
});

/** Who is in the workspace, by name and role only: no emails or ids, so an agent can name people without learning more. */
export const listMemberNames = service(Empty, async (ctx): Promise<{ name: string; role: string }[]> => {
  assertCan(ctx, "agent:manage");
  const rows = await ctx.db
    .select({ name: user.name, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.tenant.id))
    .orderBy(asc(member.createdAt));
  return rows.map(({ name, role }) => ({ name, role: toMemberRole(role) }));
});

/** Sub-agents one agent may run at once, so a runaway orchestrator cannot mint tokens without end. */
export const MAX_SUBAGENTS = 20;

/** An agent that can take sub-agents: active, in this tenant, and not a sub-agent itself (one level deep). */
async function parentFor(ctx: Ctx, parentAgentId: string): Promise<Agent> {
  const [parent] = await ctx.db.select(agentColumns).from(agents).where(and(inTenant(ctx, agents), eq(agents.id, parentAgentId), isNull(agents.revokedAt)));
  if (!parent) throw notFound("active agent", parentAgentId);
  if (parent.parentAgentId) throw invalid(`"${parent.name}" is a sub-agent already; sub-agents go one level deep.`);
  const [{ active }] = (await ctx.db
    .select({ active: count() })
    .from(agents)
    .where(and(inTenant(ctx, agents), eq(agents.parentAgentId, parent.id), isNull(agents.revokedAt)))) as [{ active: number }];
  if (Number(active) >= MAX_SUBAGENTS) throw conflict(`"${parent.name}" already runs ${MAX_SUBAGENTS} sub-agents. Revoke one it no longer needs first.`);
  return parent;
}

async function issue(ctx: Ctx, values: { name: string; parent?: Agent; purpose?: string }): Promise<{ agent: Agent; token: string }> {
  const { token, tokenHash, tokenPrefix } = generateAgentToken();
  return inTransaction(ctx, async (tx) => {
    const [agent] = await tx.db
      .insert(agents)
      .values({
        id: newId("ag"),
        tenantId: tx.tenant.id,
        name: values.name,
        tokenHash,
        tokenPrefix,
        accessLevel: values.parent ? lowerLevel(values.parent.accessLevel, "write") : "write",
        parentAgentId: values.parent?.id ?? null,
        purpose: values.purpose ?? "",
        createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      })
      .returning(agentColumns);
    await recordEvent(tx, {
      action: "agent.created",
      entityType: "agent",
      entityId: agent!.id,
      summary: values.parent ? `connected "${values.name}" as a sub-agent of "${values.parent.name}"` : `connected a new agent "${values.name}"`,
      data: { parentAgentId: values.parent?.id ?? null },
    });
    return { agent: agent!, token };
  });
}

/** Creates an agent identity, optionally as another agent's sub-agent. The plaintext token is returned once and never stored. */
export const createAgent = service(CreateAgentInput, async (ctx, { name, parentAgentId }): Promise<{ agent: Agent; token: string }> => {
  assertCan(ctx, "agent:issue_key");
  const parent = parentAgentId ? await parentFor(ctx, parentAgentId) : undefined;
  return issue(ctx, { name, parent });
});

/**
 * An agent issues a token for one of its own sub-agents (a worker it spawns, a specialist it
 * delegates to), so their work is attributed to them and shows under it on the Agents page.
 */
export const createSubagent = service(CreateSubagentInput, async (ctx, { name, purpose }): Promise<{ agent: Agent; token: string }> => {
  assertCan(ctx, "agent:delegate");
  if (ctx.actor.type !== "agent") throw invalid("People issue tokens on the Agents page.");
  const parent = await parentFor(ctx, ctx.actor.id);
  return issue(ctx, { name, parent, purpose });
});

/**
 * Ends an agent's refresh tokens. Better Auth owns these rows, but its table is part of Phean's schema,
 * and this runs in the caller's transaction so a revoke or renewal that rolls back keeps them.
 * Its access tokens need no row: every request to /mcp checks the agent itself.
 */
async function revokeTokensOf(db: Db, agentId: string): Promise<void> {
  await db.delete(oauthRefreshToken).where(eq(oauthRefreshToken.referenceId, agentId));
}

/** The same comparison as the agents_oauth_name_uq index, so what this finds is what an insert would hit. */
function renewableBy(ctx: Ctx, approverId: string, name: string): SQL | undefined {
  return and(inTenant(ctx, agents), eq(agents.createdByUserId, approverId), eq(agents.name, name), eq(agents.authKind, "oauth"), isNull(agents.revokedAt));
}

/** The agent an approval under this name would renew: this person's, in this workspace, not revoked. An expired one still counts. */
export async function findRenewableAgent(ctx: Ctx, name: string): Promise<Agent | null> {
  assertCan(ctx, "workspace:read");
  if (ctx.actor.type !== "user") return null;
  const [agent] = await ctx.db.select(agentColumns).from(agents).where(renewableBy(ctx, ctx.actor.id, name.trim()));
  return agent ?? null;
}

/**
 * A person approves an agent that signed in with OAuth. The same person, workspace and name renews
 * that row, keeping its history and watches and replacing its old tokens; anything else is a new agent.
 */
export const approveAgent = service(ApproveAgentInput, async (ctx, { name, level, lifetimeDays, oauthClientId }): Promise<{ agent: Agent; renewed: boolean }> => {
  assertCan(ctx, "agent:connect");
  const { actor } = ctx;
  if (actor.type !== "user" || actor.role === "platform_admin") throw forbidden("Only a person can approve an agent.");
  const levelLabel = ACCESS_LEVEL_META[level].label;
  if (!grantableLevels(actor.role).includes(level)) throw forbidden(`Your role cannot grant ${levelLabel} access. Ask a workspace admin.`);
  const grant = { accessLevel: level, accessExpiresAt: addDays(new Date(), lifetimeDays), oauthClientId };
  const terms = `${levelLabel} access for ${lifetimeDays} day${lifetimeDays === 1 ? "" : "s"}`;

  return inTransaction(ctx, async (tx) => {
    const lockRenewable = async () => (await tx.db.select(agentColumns).from(agents).where(renewableBy(tx, actor.id, name)).for("update"))[0];

    let existing = await lockRenewable();
    if (!existing) {
      const [created] = await tx.db
        .insert(agents)
        .values({ id: newId("ag"), tenantId: tx.tenant.id, name, authKind: "oauth", createdByUserId: actor.id, ...grant })
        // A concurrent approval got there first: this waits for it, then renews what it made.
        .onConflictDoNothing({ target: [agents.tenantId, agents.createdByUserId, agents.name], where: sql`${agents.authKind} = 'oauth' and ${agents.revokedAt} is null` })
        .returning(agentColumns);
      if (created) {
        await recordEvent(tx, {
          action: "agent.created",
          entityType: "agent",
          entityId: created.id,
          summary: `connected a new agent "${name}" with ${terms}`,
          data: { parentAgentId: null, level, lifetimeDays },
        });
        return { agent: created, renewed: false };
      }
      existing = await lockRenewable();
      if (!existing) throw conflict(`"${name}" was revoked just now. Approve it again.`);
    }

    const [agent] = await tx.db.update(agents).set(grant).where(and(inTenant(tx, agents), eq(agents.id, existing.id))).returning(agentColumns);
    await revokeTokensOf(tx.db, existing.id);
    await recordEvent(tx, {
      action: "agent.renewed",
      entityType: "agent",
      entityId: existing.id,
      summary: `renewed agent "${name}" with ${terms}`,
      data: { level, lifetimeDays },
    });
    return { agent: agent!, renewed: true };
  });
});

function assertCanRevoke(ctx: Ctx, target: Agent): void {
  const { actor } = ctx;
  if (actor.type === "agent" && actor.id === target.id) throw forbidden("An agent cannot revoke itself. Ask a workspace admin to revoke it.");
  if (can(actor, "agent:manage")) return;
  if (actor.type === "agent") {
    if (target.parentAgentId !== actor.id) throw forbidden("Agents revoke only their own sub-agents. Ask a workspace admin to revoke this one.");
    return;
  }
  if (target.createdByUserId !== actor.id) assertCan(ctx, "agent:manage");
}

/**
 * Revokes an agent and every sub-agent it runs, and their tokens. A person needs `agent:manage`, or
 * `agent:connect` for an agent they approved. An agent needs `agent:manage` to revoke any agent but
 * itself; otherwise, with `agent:delegate`, only its own sub-agents.
 */
export const revokeAgent = service(AgentRefInput, async (ctx, { agentId }): Promise<Agent> => {
  if (!can(ctx.actor, "agent:connect") && !can(ctx.actor, "agent:delegate")) assertCan(ctx, "agent:manage");
  return inTransaction(ctx, async (tx) => {
    const [target] = await tx.db.select(agentColumns).from(agents).where(and(inTenant(tx, agents), eq(agents.id, agentId), isNull(agents.revokedAt)));
    if (!target) throw notFound("active agent", agentId);
    assertCanRevoke(tx, target);
    const revoked = await tx.db
      .update(agents)
      .set({ revokedAt: new Date() })
      .where(and(inTenant(tx, agents), or(eq(agents.id, agentId), eq(agents.parentAgentId, agentId)), isNull(agents.revokedAt)))
      .returning(agentColumns);
    for (const agent of revoked) {
      await disableWebhooksOf(tx, agent.id);
      await revokeTokensOf(tx.db, agent.id);
    }
    const children = revoked.filter((agent) => agent.id !== agentId);
    await recordEvent(tx, {
      action: "agent.revoked",
      entityType: "agent",
      entityId: agentId,
      summary: children.length ? `revoked agent "${target.name}" and its ${children.length} sub-agent${children.length === 1 ? "" : "s"}` : `revoked agent "${target.name}"`,
      data: { subagents: children.map((agent) => agent.id) },
    });
    return revoked.find((agent) => agent.id === agentId)!;
  });
});

export interface AgentPrincipal {
  agent: { id: string; name: string; level: AgentAccessLevel };
  /** When its access lapses (the sooner of its own and its parent's); null for a key. */
  accessExpiresAt: Date | null;
  tenant: Tenant;
}

const parentAgent = alias(agents, "parent_agent");
const approver = alias(member, "approver");
const parentApprover = alias(member, "parent_approver");

/** A grant, capped by what its approver can grant now. A key has no approver to cap it. */
function grantedLevel(level: AgentAccessLevel, authKind: "key" | "oauth", approverRole: string | null): AgentAccessLevel {
  return authKind === "oauth" ? lowerLevel(level, highestGrantableLevel(toMemberRole(approverRole))) : level;
}

/** Coarse-grained so a busy agent does not write on every request. */
async function touchAgent(db: Db, agentId: string): Promise<void> {
  await db
    .update(agents)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(agents.id, agentId), or(isNull(agents.lastSeenAt), lt(agents.lastSeenAt, sql`now() - ${LAST_SEEN_RESOLUTION}`))));
}

/**
 * The one way every token path turns an agent row into a principal: null unless `liveAgent()` holds,
 * and the level is the agent's grant, capped by its approver's current role and, for a sub-agent, by
 * its parent's level worked out the same way.
 */
async function resolvePrincipal(db: Db, match: SQL | undefined): Promise<AgentPrincipal | null> {
  const [row] = await db
    .select({
      id: agents.id,
      name: agents.name,
      level: agents.accessLevel,
      expiresAt: agents.accessExpiresAt,
      parentExpiresAt: parentAgent.accessExpiresAt,
      authKind: agents.authKind,
      approverRole: approver.role,
      parentLevel: parentAgent.accessLevel,
      parentAuthKind: parentAgent.authKind,
      parentApproverRole: parentApprover.role,
      tenantId: organization.id,
      tenantSlug: organization.slug,
      tenantName: organization.name,
    })
    .from(agents)
    .innerJoin(organization, eq(organization.id, agents.tenantId))
    .leftJoin(approver, and(eq(approver.organizationId, agents.tenantId), eq(approver.userId, agents.createdByUserId)))
    .leftJoin(parentAgent, and(eq(parentAgent.tenantId, agents.tenantId), eq(parentAgent.id, agents.parentAgentId)))
    .leftJoin(parentApprover, and(eq(parentApprover.organizationId, agents.tenantId), eq(parentApprover.userId, parentAgent.createdByUserId)))
    .where(and(match, liveAgent()));
  if (!row) return null;

  await touchAgent(db, row.id);

  const own = grantedLevel(row.level, row.authKind, row.approverRole);
  const level = row.parentLevel && row.parentAuthKind ? lowerLevel(own, grantedLevel(row.parentLevel, row.parentAuthKind, row.parentApproverRole)) : own;
  return {
    agent: { id: row.id, name: row.name, level },
    accessExpiresAt: [row.expiresAt, row.parentExpiresAt].filter((date): date is Date => !!date).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    tenant: { id: row.tenantId, slug: row.tenantSlug, name: row.tenantName },
  };
}

/** Resolves a bearer token to its agent and tenant. Returns null for an unknown token or an agent that is not live. */
export async function authenticateAgentToken(db: Db, token: string): Promise<AgentPrincipal | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
  return resolvePrincipal(db, eq(agents.tokenHash, hashToken(token)));
}

/** Resolves the agent a verified OAuth token names. Returns null unless it is a live OAuth agent. */
export async function resolveOAuthAgent(db: Db, agentId: string): Promise<AgentPrincipal | null> {
  return resolvePrincipal(db, and(eq(agents.id, agentId), eq(agents.authKind, "oauth")));
}

/** The header a sub-agent sends with its parent's token to say who it is. */
export const AGENT_NAME_HEADER = "phean-agent-name";

/** A name a sub-agent may give itself: printable, trimmed, within the name limit. */
export function subagentName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > LIMITS.name || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/** What stands in for a detected sub-agent's token hash: never a real hash, and one per name under a parent. */
const sharedKey = (parentId: string, name: string) => `shared:${parentId}:${name.toLowerCase()}`;

/**
 * The identity behind a request that carries an agent's own token and a name of its own
 * (Phean-Agent-Name): that agent's sub-agent of that name, made the first time Phean sees it, so
 * workers that share their orchestrator's key are still told apart and listed under it. A revoked
 * name stays refused (null), as does any sub-agent while its parent is not live. An agent that cannot
 * delegate, one at its limit of sub-agents, or a sub-agent's own token keeps acting as itself rather
 * than starting a new name; a name that already exists keeps resolving, capped at its parent's level.
 */
export async function resolveNamedSubagent(db: Db, principal: AgentPrincipal, rawName: string | null | undefined): Promise<AgentPrincipal | null> {
  const name = subagentName(rawName);
  if (!name) return principal;
  const [parent] = await db.select(agentColumns).from(agents).where(eq(agents.id, principal.agent.id));
  if (!parent || parent.parentAgentId || name.toLowerCase() === parent.name.toLowerCase()) return principal;

  const key = sharedKey(parent.id, name);
  const find = () => db.select(agentColumns).from(agents).where(and(eq(agents.tenantId, principal.tenant.id), eq(agents.tokenHash, key)));
  let [sub] = await find();
  if (!sub) {
    const ctx = agentContext(db, principal);
    if (!can(ctx.actor, "agent:delegate")) return principal;
    const [{ active }] = (await db
      .select({ active: count() })
      .from(agents)
      .where(and(inTenant(ctx, agents), eq(agents.parentAgentId, parent.id), isNull(agents.revokedAt)))) as [{ active: number }];
    if (Number(active) >= MAX_SUBAGENTS) return principal;
    await inTransaction(ctx, async (tx) => {
      const [created] = await tx.db
        .insert(agents)
        .values({
          id: newId("ag"),
          tenantId: tx.tenant.id,
          name,
          tokenHash: key,
          tokenPrefix: parent.tokenPrefix,
          parentAgentId: parent.id,
          accessLevel: lowerLevel(parent.accessLevel, "write"),
          sharesParentKey: true,
          lastSeenAt: new Date(),
        })
        // Two first requests at once: one row wins, the other reads it below.
        .onConflictDoNothing({ target: agents.tokenHash })
        .returning(agentColumns);
      if (created) {
        await recordEvent(tx, {
          action: "agent.created",
          entityType: "agent",
          entityId: created.id,
          summary: `started "${name}" as a sub-agent, on its own key`,
          data: { parentAgentId: parent.id, sharesParentKey: true },
        });
      }
    });
    [sub] = await find();
  }
  return sub ? resolvePrincipal(db, eq(agents.id, sub.id)) : null;
}

export function agentContext(db: Db, principal: AgentPrincipal): Ctx {
  return {
    db,
    tenant: principal.tenant,
    actor: { type: "agent", id: principal.agent.id, name: principal.agent.name, role: agentRole(principal.agent.level) },
  };
}
