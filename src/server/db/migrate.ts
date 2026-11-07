import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Client } from "pg";

import { openPglite } from "./pglite";
import { isPostgresUrl, postgresConnectionString } from "./url";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Applies pending migrations to an existing PGlite client (used by tests). */
export async function migratePgliteClient(client: PGlite): Promise<void> {
  await migratePglite(drizzlePglite(client), { migrationsFolder: MIGRATIONS_FOLDER });
}

/** A fixed key for the session-level advisory lock migrations take (any constant bigint). */
export const MIGRATION_LOCK_KEY = 72_450_919_301;

/**
 * Applies pending migrations to the database behind `url`, then closes the connection. Two builds
 * can migrate the same database at once (a merge deploys production while the branch deploys a
 * preview), and Drizzle's migrator takes no lock: both would run the same new migration, and the
 * second would fail on "already exists". So each takes an advisory lock on its one connection
 * first; the second waits, then finds the migrations applied and has nothing to do.
 */
export async function migrateDatabase(url: string): Promise<void> {
  if (isPostgresUrl(url)) {
    const client = new Client({ connectionString: postgresConnectionString(url) });
    await client.connect();
    try {
      await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      await migratePg(drizzlePg(client), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      // Ending the session releases the lock even if migrating failed.
      await client.end();
    }
    return;
  }
  const client = openPglite(url);
  try {
    await migratePgliteClient(client);
  } finally {
    await client.close();
  }
}
