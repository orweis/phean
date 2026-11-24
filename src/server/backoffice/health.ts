import { sql } from "drizzle-orm";
import { z } from "zod";

import { queryRows } from "../db/raw";
import { epochMs } from "./queries";
import { rolledUpThrough } from "./rollup";
import { platformService } from "./service";

export interface SystemHealth {
  webhooks: { total: number; active: number; disabled: number; failing: number; delivered: number; pending: number; dead: number; oldestPendingAt: number | null };
  push: { devices: number; sent: number; pending: number; dead: number; oldestPendingAt: number | null };
  pipelines: { liveRuns: number; failedRuns: number; endedRuns: number; overdueStops: number; oldestOverdueAt: number | null; schedules: number; oldestScheduleCheckAt: number | null };
  realtime: { streams: number };
  rateLimits: { endpoint: string; counters: number; requests: number }[];
  tables: { table: string; bytes: number; rows: number }[];
  databaseBytes: number | null;
  rollup: { throughDay: string | null; ranAt: Date | null };
  /** When these figures were read, for ages and lags (ms). */
  readAt: number;
}

/** A stop's limit counts as overdue once the minute sweep has had two chances to act on it. */
const OVERDUE_GRACE = sql`interval '2 minutes'`;

/**
 * Whether Phean's background work keeps up: webhook and push delivery in the last 24 hours and their
 * backlog, pipeline limits and schedules the sweep has not reached, open realtime streams, busy
 * rate-limit counters (by endpoint; the client's address is never read out), the largest tables, and
 * the usage rollup's freshness.
 */
export const getSystemHealth = platformService("view.health", z.object({}), async (ctx): Promise<SystemHealth> => {
  const db = ctx.db;
  const [[webhooks], [push], [pipelines], [realtime], rateLimits, tables, size, rollup] = await Promise.all([
    queryRows<SystemHealth["webhooks"]>(
      db,
      sql`select (select count(*)::int from webhooks) as total,
            (select count(*)::int from webhooks where status = 'active') as active,
            (select count(*)::int from webhooks where status = 'disabled') as disabled,
            (select count(*)::int from webhooks where status = 'active' and consecutive_failures > 0) as failing,
            (select count(*)::int from webhook_deliveries where status = 'delivered' and created_at > now() - interval '24 hours') as delivered,
            (select count(*)::int from webhook_deliveries where status = 'pending') as pending,
            (select count(*)::int from webhook_deliveries where status = 'dead' and created_at > now() - interval '24 hours') as dead,
            (select ${epochMs(sql`min(created_at)`)} from webhook_deliveries where status = 'pending') as "oldestPendingAt"`,
    ),
    queryRows<SystemHealth["push"]>(
      db,
      sql`select (select count(*)::int from push_devices) as devices,
            (select count(*)::int from push_deliveries where status = 'sent' and created_at > now() - interval '24 hours') as sent,
            (select count(*)::int from push_deliveries where status = 'pending') as pending,
            (select count(*)::int from push_deliveries where status = 'dead' and created_at > now() - interval '24 hours') as dead,
            (select ${epochMs(sql`min(next_attempt_at)`)} from push_deliveries where status = 'pending') as "oldestPendingAt"`,
    ),
    queryRows<SystemHealth["pipelines"]>(
      db,
      sql`select (select count(*)::int from pipeline_runs where status in ('running', 'waiting')) as "liveRuns",
            (select count(*)::int from pipeline_runs where status = 'failed' and ended_at > now() - interval '7 days') as "failedRuns",
            (select count(*)::int from pipeline_runs where status in ('done', 'failed', 'cancelled') and ended_at > now() - interval '7 days') as "endedRuns",
            (select count(*)::int from pipeline_run_stops where due_at < now() - ${OVERDUE_GRACE} and superseded_at is null and state in ('active', 'waiting')) as "overdueStops",
            (select ${epochMs(sql`min(due_at)`)} from pipeline_run_stops where due_at < now() - ${OVERDUE_GRACE} and superseded_at is null and state in ('active', 'waiting')) as "oldestOverdueAt",
            (select count(*)::int from pipeline_triggers t join pipelines p on p.tenant_id = t.tenant_id and p.id = t.pipeline_id
               where t.kind = 'schedule' and p.status = 'active') as schedules,
            (select ${epochMs(sql`min(t.checked_at)`)} from pipeline_triggers t join pipelines p on p.tenant_id = t.tenant_id and p.id = t.pipeline_id
               where t.kind = 'schedule' and p.status = 'active') as "oldestScheduleCheckAt"`,
    ),
    queryRows<SystemHealth["realtime"]>(db, sql`select count(*)::int as streams from realtime_streams where renewed_at > now() - interval '2 minutes'`),
    queryRows<SystemHealth["rateLimits"][number]>(
      db,
      // Better Auth keys are "<address>|<path>", Phean's own "<name>:<address>:…": only the path or name leaves the database.
      sql`select case when position('|' in key) > 0 then split_part(key, '|', 2) else split_part(key, ':', 1) end as endpoint,
            count(*)::int as counters, sum(count)::int as requests
          from rate_limit where last_request > ${Date.now() - 3_600_000} group by 1 order by 3 desc limit 15`,
    ),
    queryRows<SystemHealth["tables"][number]>(
      db,
      sql`select relname as table, pg_total_relation_size(relid)::float8 as bytes, n_live_tup::float8 as rows
          from pg_stat_user_tables order by 2 desc limit 15`,
    ),
    queryRows<{ bytes: number }>(db, sql`select pg_database_size(current_database())::float8 as bytes`).catch(() => []),
    rolledUpThrough(db),
  ]);
  const numbers = <T extends object>(row: T | undefined) =>
    Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, value === null ? null : Number(value)])) as T;
  return {
    webhooks: numbers(webhooks),
    push: numbers(push),
    pipelines: numbers(pipelines),
    realtime: numbers(realtime),
    rateLimits: rateLimits.map((row) => ({ endpoint: row.endpoint, counters: Number(row.counters), requests: Number(row.requests) })),
    tables: tables.map((row) => ({ table: row.table, bytes: Number(row.bytes), rows: Number(row.rows) })),
    databaseBytes: size[0] ? Number(size[0].bytes) : null,
    rollup,
    readAt: Date.now(),
  };
});
