import { sql, type SQL } from "drizzle-orm";

import type { DayWindow } from "@/lib/backoffice";
import { dayOf } from "@/lib/dates";

import type { Db } from "../db/client";
import { queryRows } from "../db/raw";
import { usageSource } from "./rollup";

/**
 * Shared cross-tenant reads for the backoffice services. Every query names its columns (never a
 * `select *`), so a secret column added to a table later is never read here by accident.
 */

/** A timestamp column as epoch milliseconds (a `timestamp` without zone is read as UTC). */
export const epochMs = (column: SQL) => sql`(extract(epoch from ${column}) * 1000)::float8`;

/** A `timestamp` or `timestamptz` column's UTC day, as YYYY-MM-DD. */
export const utcDay = (column: SQL, withZone = true) => (withZone ? sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')` : sql`to_char(${column}, 'YYYY-MM-DD')`);

/** `ILIKE` pattern for words a person typed: `%` and `_` match themselves. */
export function containsPattern(words: string): string {
  return `%${words.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** The first moment of a window's first day, for timestamp comparisons. */
export const windowStart = (window: DayWindow) => dayOf(window.from).toISOString();

/** Rows of `(day, value)` counting `table.column` per UTC day since `from`. */
export async function countPerDay(db: Db, table: SQL, column: SQL, from: string, withZone: boolean): Promise<{ day: string; value: number }[]> {
  const rows = await queryRows<{ day: string; value: number }>(
    db,
    sql`select ${utcDay(column, withZone)} as day, count(*)::int as value from ${table} where ${column} >= ${from}::timestamp group by 1`,
  );
  return rows.map((row) => ({ day: row.day, value: Number(row.value) }));
}

/** Events per day for the given actions (summed over every workspace and actor), since `fromDay`. */
export async function actionsPerDay(db: Db, fromDay: string, actions: readonly string[], now: Date): Promise<{ day: string; action: string; value: number }[]> {
  if (actions.length === 0) return [];
  const source = await usageSource(db, fromDay, now);
  const rows = await queryRows<{ day: string; action: string; value: number }>(
    db,
    sql`select u.day, u.action, sum(u.events)::int as value from ${source} as u
        where u.day >= ${fromDay} and u.action in (${sql.join(actions.map((action) => sql`${action}`), sql`, `)})
        group by 1, 2`,
  );
  return rows.map((row) => ({ ...row, value: Number(row.value) }));
}

/** Who acted on which day since `fromDay`: people, agents (not the pipelines agent) and their workspaces. */
export async function activeActors(db: Db, fromDay: string, now: Date): Promise<{ day: string; actorType: "user" | "agent"; actorId: string; tenantId: string }[]> {
  const source = await usageSource(db, fromDay, now);
  return queryRows(
    db,
    sql`select distinct u.day, u.actor_type as "actorType", u.actor_id as "actorId", u.tenant_id as "tenantId" from ${source} as u
        where u.day >= ${fromDay} and u.actor_type in ('user', 'agent')
        union
        select distinct day::text, 'agent', agent_id, tenant_id from tool_calls_daily where day >= ${fromDay}::date`,
  );
}

/**
 * Closed requests a person answered since `from`: when each closed and how long it took (ms). Only
 * tasks updated since `from` are expanded (closing a request updates its task), through
 * `tasks_answered_updated_idx`, so the cost follows the window, not every answer ever given.
 */
export async function answerDurations(db: Db, from: string, tenantId?: string): Promise<{ closedAt: number; ms: number }[]> {
  const rows = await queryRows<{ closedAt: number; ms: number }>(
    db,
    sql`select ${epochMs(sql`(a->>'closedAt')::timestamptz`)} as "closedAt",
          ${epochMs(sql`(a->>'closedAt')::timestamptz`)} - ${epochMs(sql`(a->>'askedAt')::timestamptz`)} as ms
        from tasks t cross join lateral jsonb_array_elements(t.input_answers) as a
        where t.input_answers <> '[]'::jsonb and t.updated_at >= ${from}::timestamptz ${tenantId ? sql`and t.tenant_id = ${tenantId}` : sql``}
          and a->>'outcome' in ('answered', 'answered_elsewhere')
          and (a->>'closedAt')::timestamptz >= ${from}::timestamptz`,
  );
  return rows.map((row) => ({ closedAt: Number(row.closedAt), ms: Math.max(0, Number(row.ms)) }));
}
