import { aliasedTable, and, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";

import { agents, member } from "../db/schema";

const parent = aliasedTable(agents, "live_parent");

/** One agent's own standing: not revoked, not lapsed, and a key or an approver who is still a member. */
function standing(agent: typeof agents): SQL {
  return and(
    isNull(agent.revokedAt),
    or(isNull(agent.accessExpiresAt), gt(agent.accessExpiresAt, sql`now()`)),
    or(
      eq(agent.authKind, "key"),
      sql`exists (select 1 from ${member} where ${member.organizationId} = ${agent.tenantId} and ${member.userId} = ${agent.createdByUserId})`,
    ),
  )!;
}

/**
 * Whether a row of `agents` may act now. A sub-agent also needs its parent to stand, so an expiring
 * agent cannot mint itself a key that outlives it. Sub-agents go one level deep.
 */
export function liveAgent(): SQL {
  return and(
    standing(agents),
    or(
      isNull(agents.parentAgentId),
      sql`exists (select 1 from ${agents} as ${sql.identifier("live_parent")} where ${parent.tenantId} = ${agents.tenantId} and ${parent.id} = ${agents.parentAgentId} and ${standing(parent)})`,
    ),
  )!;
}
