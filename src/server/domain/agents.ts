import { createHash, randomBytes } from "node:crypto";

import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { AGENT_TOKEN_PREFIX } from "@/lib/domain";

import type { Db } from "../db/client";
import { publicColumns } from "../db/columns";
import { newId } from "../db/ids";
import { agents, organization, type AgentRow } from "../db/schema";
import { inTenant, inTransaction, type Ctx, type Tenant } from "./context";
import { notFound } from "./errors";
import { recordEvent } from "./events";
import { assertCan } from "./policy";
import { AgentRefInput, CreateAgentInput, Empty } from "./schemas";
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

/** Creates an agent identity. The plaintext token is returned once and never stored. */
export const createAgent = service(CreateAgentInput, async (ctx, { name }): Promise<{ agent: Agent; token: string }> => {
  assertCan(ctx, "agent:manage");
  const { token, tokenHash, tokenPrefix } = generateAgentToken();

  return inTransaction(ctx, async (tx) => {
    const [agent] = await tx.db
      .insert(agents)
      .values({
        id: newId("ag"),
        tenantId: tx.tenant.id,
        name,
        tokenHash,
        tokenPrefix,
        createdByUserId: tx.actor.type === "user" ? tx.actor.id : null,
      })
      .returning(agentColumns);
    await recordEvent(tx, {
      action: "agent.created",
      entityType: "agent",
      entityId: agent!.id,
      summary: `connected a new agent "${name}"`,
    });
    return { agent: agent!, token };
  });
});

export const revokeAgent = service(AgentRefInput, async (ctx, { agentId }): Promise<Agent> => {
  assertCan(ctx, "agent:manage");
  return inTransaction(ctx, async (tx) => {
    const [agent] = await tx.db
      .update(agents)
      .set({ revokedAt: new Date() })
      .where(and(inTenant(tx, agents), eq(agents.id, agentId), isNull(agents.revokedAt)))
      .returning(agentColumns);
    if (!agent) throw notFound("active agent", agentId);
    await disableWebhooksOf(tx, agentId);
    await recordEvent(tx, {
      action: "agent.revoked",
      entityType: "agent",
      entityId: agentId,
      summary: `revoked agent "${agent.name}"`,
    });
    return agent;
  });
});

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

export function agentContext(db: Db, principal: AgentPrincipal): Ctx {
  return {
    db,
    tenant: principal.tenant,
    actor: { type: "agent", id: principal.agent.id, name: principal.agent.name, role: "agent" },
  };
}
