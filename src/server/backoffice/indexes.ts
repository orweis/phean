import { sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { queryRows } from "../db/raw";

/**
 * Indexes on busy tables the backoffice reads, built outside the migrations on purpose. Migrations
 * run in a transaction during a deploy, while the previous release still serves traffic, and a plain
 * `CREATE INDEX` on `events` or `tasks` would block that release's writes until it finished.
 * `CREATE INDEX CONCURRENTLY` does not block writes but cannot run in a transaction, so the hourly
 * rollup cron ensures them instead, one statement at a time. Until it first runs, the backoffice's
 * reads are slower, never wrong.
 */
export const BACKOFFICE_INDEXES = [
  // The daily rollup, and the days it has not stored yet, read one range of every workspace's events.
  { name: "events_created_idx", definition: sql`events (created_at)` },
  // The activation funnel reads the first request and answer per workspace and person.
  { name: "events_action_created_idx", definition: sql`events (action, created_at)` },
  // Median time to answer expands only tasks whose answers changed in the window.
  { name: "tasks_answered_updated_idx", definition: sql`tasks (updated_at) where input_answers <> '[]'::jsonb` },
] as const;

/**
 * Creates any of `BACKOFFICE_INDEXES` that is missing, concurrently. A concurrent build that was cut
 * off leaves an invalid index behind, which `IF NOT EXISTS` would keep skipping: that one is dropped
 * and built again. Returns the names it built.
 */
export async function ensureBackofficeIndexes(db: Db): Promise<string[]> {
  const present = await queryRows<{ name: string; valid: boolean }>(
    db,
    sql`select c.relname as name, i.indisvalid as valid from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname in (${sql.join(BACKOFFICE_INDEXES.map((index) => sql`${index.name}`), sql`, `)})`,
  );
  const built: string[] = [];
  for (const index of BACKOFFICE_INDEXES) {
    const found = present.find((row) => row.name === index.name);
    if (found?.valid) continue;
    if (found) await db.execute(sql`drop index concurrently if exists ${sql.identifier(index.name)}`);
    await db.execute(sql`create index concurrently if not exists ${sql.identifier(index.name)} on ${index.definition}`);
    built.push(index.name);
  }
  return built;
}
