import { createHash, randomBytes } from "node:crypto";

import { and, asc, count, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { AGENT_TOKEN_PREFIX, LIMITS } from "@/lib/domain";

import type { Db } from "../db/client";
import { publicColumns } from "../db/columns";
import { newId } from "../db/ids";
import { agents, organization, type AgentRow } from "../db/schema";
import { inTenant, inTransaction, type Ctx, type Tenant } from "./context";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { recordEvent, recordEvents } from "./events";
import { assertCan } from "./policy";
import { AgentRefInput, CreateAgentInput, CreateSubagentInput, Empty } from "./schemas";
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
  assertCan(ctx, "agent:manage");
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
 * Revokes an agent and every sub-agent it runs. Owners and admins revoke any agent; an agent
 * revokes only its own sub-agents.
 */
export const revokeAgent = service(AgentRefInput, async (ctx, { agentId }): Promise<Agent> => {
  if (ctx.actor.type === "agent") {
    assertCan(ctx, "agent:delegate");
  } else {
    assertCan(ctx, "agent:manage");
  }
  return inTransaction(ctx, async (tx) => {
    const [target] = await tx.db.select(agentColumns).from(agents).where(and(inTenant(tx, agents), eq(agents.id, agentId), isNull(agents.revokedAt)));
    if (!target) throw notFound("active agent", agentId);
    if (tx.actor.type === "agent" && target.parentAgentId !== tx.actor.id) throw forbidden("Agents revoke only their own sub-agents. Ask a workspace admin to revoke this one.");
    const revoked = await tx.db
      .update(agents)
      .set({ revokedAt: new Date() })
      .where(and(inTenant(tx, agents), or(eq(agents.id, agentId), eq(agents.parentAgentId, agentId)), isNull(agents.revokedAt)))
      .returning(agentColumns);
    for (const agent of revoked) await disableWebhooksOf(tx, agent.id);
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

/**
 * Files revoked agents away, off the Agents list (its Archived view keeps them, with their past
 * work attributed as before). Only revoked agents are archived, and an agent's revoked sub-agents go
 * with it; with no `agentId`, every revoked agent is.
 */
async function setArchived(ctx: Ctx, agentId: string | null, archived: boolean): Promise<Agent[]> {
  assertCan(ctx, "agent:manage");
  return inTransaction(ctx, async (tx) => {
    if (agentId) {
      const [target] = await tx.db.select(agentColumns).from(agents).where(and(inTenant(tx, agents), eq(agents.id, agentId)));
      if (!target) throw notFound("agent", agentId);
      if (!target.revokedAt) throw conflict(`${target.name} is still active. Revoke it before archiving it.`);
    }
    const changed = await tx.db
      .update(agents)
      .set({ archivedAt: archived ? new Date() : null })
      .where(
        and(
          inTenant(tx, agents),
          isNotNull(agents.revokedAt),
          archived ? isNull(agents.archivedAt) : isNotNull(agents.archivedAt),
          agentId ? or(eq(agents.id, agentId), eq(agents.parentAgentId, agentId)) : undefined,
        ),
      )
      .returning(agentColumns);
    await recordEvents(
      tx,
      changed.map((agent) => ({
        action: archived ? "agent.archived" : "agent.unarchived",
        entityType: "agent",
        entityId: agent.id,
        summary: `${archived ? "archived" : "unarchived"} revoked agent "${agent.name}"`,
        data: {},
      })),
    );
    return changed;
  });
}

export const archiveAgent = service(AgentRefInput, async (ctx, { agentId }) => ({ archived: (await setArchived(ctx, agentId, true)).length }));
export const unarchiveAgent = service(AgentRefInput, async (ctx, { agentId }) => ({ unarchived: (await setArchived(ctx, agentId, false)).length }));
/** Archives every revoked agent at once. */
export const archiveRevokedAgents = service(Empty, async (ctx) => ({ archived: (await setArchived(ctx, null, true)).length }));

export interface AgentPrincipal {
  agent: { id: string; name: string };
  tenant: Tenant;
}

/** Resolves a bearer token to its agent and tenant. Returns null for unknown or revoked tokens. */
export async function authenticateAgentToken(db: Db, token: string): Promise<AgentPrincipal | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
  const tokenHash = hashToken(token);

  const [row] = await db
    .select({
      agentId: agents.id,
      agentName: agents.name,
      tenantId: organization.id,
      tenantSlug: organization.slug,
      tenantName: organization.name,
    })
    .from(agents)
    .innerJoin(organization, eq(organization.id, agents.tenantId))
    .where(and(eq(agents.tokenHash, tokenHash), isNull(agents.revokedAt)));
  if (!row) return null;

  // Coarse-grained so a busy agent does not write on every request.
  await db
    .update(agents)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(agents.id, row.agentId),
        or(isNull(agents.lastSeenAt), lt(agents.lastSeenAt, sql`now() - ${LAST_SEEN_RESOLUTION}`)),
      ),
    );

  return {
    agent: { id: row.agentId, name: row.agentName },
    tenant: { id: row.tenantId, slug: row.tenantSlug, name: row.tenantName },
  };
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
 * name stays refused (null). An agent at its limit of sub-agents, or a sub-agent's own token, keeps
 * acting as itself.
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
  if (!sub || sub.revokedAt) return null;
  await db
    .update(agents)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(agents.id, sub.id), or(isNull(agents.lastSeenAt), lt(agents.lastSeenAt, sql`now() - ${LAST_SEEN_RESOLUTION}`))));
  return { agent: { id: sub.id, name: sub.name }, tenant: principal.tenant };
}

export function agentContext(db: Db, principal: AgentPrincipal): Ctx {
  return {
    db,
    tenant: principal.tenant,
    actor: { type: "agent", id: principal.agent.id, name: principal.agent.name, role: "agent" },
  };
}
