import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";

import { openPglite } from "./pglite";
import { isPostgresUrl } from "./url";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Applies pending migrations to an existing PGlite client (used by tests). */
export async function migratePgliteClient(client: PGlite): Promise<void> {
  await migratePglite(drizzlePglite(client), { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Applies pending migrations to the database behind `url`, then closes the connection. */
export async function migrateDatabase(url: string): Promise<void> {
  if (isPostgresUrl(url)) {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      await migratePg(drizzlePg(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await pool.end();
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
