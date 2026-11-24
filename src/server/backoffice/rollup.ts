import { eq, sql, type SQL } from "drizzle-orm";

import { addDays, dayOf, isoDate, todayIso } from "@/lib/dates";

import type { Db } from "../db/client";
import { usageRollupState } from "../db/schema";

/** How far back the first rollup reaches; older events stay in the log, unrolled. */
export const ROLLUP_MAX_DAYS = 120;

const STATE_ID = "usage";

/**
 * Events counted per UTC day, workspace, actor and action for `[from, to)` (YYYY-MM-DD), as rows of
 * `(day, tenant_id, actor_type, actor_id, action, events)`. The pipelines agent's events count as
 * `system`; `task.done` adds completions and updates to done. The rollup stores this, and readers
 * compute the days it has not stored yet with the same SQL. The range uses `events_created_idx`.
 */
export function usageSelect(from: string, to: string): SQL {
  const range = sql`e.created_at >= ${dayOf(from).toISOString()}::timestamptz and e.created_at < ${dayOf(to).toISOString()}::timestamptz`;
  const actorType = sql`case when e.actor_type = 'agent' and a.auth_kind = 'system' then 'system' else e.actor_type::text end`;
  const day = sql`to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD')`;
  return sql`
    select ${day} as day, e.tenant_id, ${actorType} as actor_type, e.actor_id, e.action, count(*)::int as events
    from events e left join agents a on e.actor_type = 'agent' and a.id = e.actor_id
    where ${range}
    group by 1, 2, 3, 4, 5
    union all
    select ${day} as day, e.tenant_id, ${actorType} as actor_type, e.actor_id, 'task.done' as action, count(*)::int as events
    from events e left join agents a on e.actor_type = 'agent' and a.id = e.actor_id
    where ${range} and (e.action = 'task.completed' or (e.action = 'task.updated' and e.data->>'status' = 'done'))
    group by 1, 2, 3, 4, 5`;
}

/** The last whole day stored in `usage_daily`, or null before the first rollup. */
export async function rolledUpThrough(db: Db): Promise<{ throughDay: string | null; ranAt: Date | null }> {
  const [row] = await db.select().from(usageRollupState).where(eq(usageRollupState.id, STATE_ID));
  return { throughDay: row?.throughDay ?? null, ranAt: row?.ranAt ?? null };
}

/**
 * Usage rows for every day from `fromDay` on, as an SQL subquery with text `day`: stored rows through
 * the last rolled-up day, and the days after it (today at least) computed live from `events`. A
 * rollup that has fallen behind therefore costs a slower page, never a wrong one.
 */
export async function usageSource(db: Db, fromDay: string, now = new Date()): Promise<SQL> {
  const { throughDay } = await rolledUpThrough(db);
  const tomorrow = isoDate(addDays(dayOf(todayIso(now)), 1));
  const liveFrom = throughDay && throughDay >= fromDay ? isoDate(addDays(dayOf(throughDay), 1)) : fromDay;
  const stored = throughDay && throughDay >= fromDay
    ? sql`select day::text as day, tenant_id, actor_type, actor_id, action, events from usage_daily where day >= ${fromDay}::date and day <= ${throughDay}::date
      union all `
    : sql``;
  return sql`(${stored}${usageSelect(liveFrom, tomorrow)})`;
}

export interface RollupReport {
  from: string;
  through: string;
  rows: number;
}

/**
 * Recomputes whole days of `usage_daily`: from the day after the last one stored (yesterday at the
 * latest, so a late commit is caught on the next run; at most `ROLLUP_MAX_DAYS` back the first time)
 * through yesterday, or every day back to `ROLLUP_MAX_DAYS` with `full` (the seed, after it backdates
 * history). Each run deletes and re-inserts those days in one transaction, so running twice changes
 * nothing; an advisory lock taken first makes two runs at once (a cron overlapping a manual call)
 * queue rather than collide on the primary key. Today is never stored: readers compute it live.
 */
export async function rollUpUsage(db: Db, now = new Date(), { full = false } = {}): Promise<RollupReport> {
  const today = todayIso(now);
  const yesterday = isoDate(addDays(dayOf(today), -1));
  const earliest = isoDate(addDays(dayOf(today), -ROLLUP_MAX_DAYS));
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('usage_rollup'))`);
    // Read under the lock, so a run that waited starts where the one before it finished.
    const { throughDay } = await rolledUpThrough(tx as unknown as Db);
    let from = throughDay && !full ? isoDate(addDays(dayOf(throughDay), 1)) : earliest;
    if (from > yesterday) from = yesterday;
    if (from < earliest) from = earliest;
    await tx.execute(sql`delete from usage_daily where day >= ${from}::date and day < ${today}::date`);
    const inserted = (await tx.execute(sql`
      insert into usage_daily (day, tenant_id, actor_type, actor_id, action, events)
      select day::date, tenant_id, actor_type, actor_id, action, events from (${usageSelect(from, today)}) as usage`)) as unknown as { rowCount?: number; affectedRows?: number };
    await tx
      .insert(usageRollupState)
      .values({ id: STATE_ID, throughDay: yesterday, ranAt: now })
      .onConflictDoUpdate({ target: usageRollupState.id, set: { throughDay: yesterday, ranAt: now } });
    return { from, through: yesterday, rows: inserted.rowCount ?? inserted.affectedRows ?? 0 };
  });
}
