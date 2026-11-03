import type { PGlite } from "@electric-sql/pglite";
import { attachDatabasePool } from "@vercel/functions";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";

import { openPglite } from "./pglite";
import * as schema from "./schema";
import { isPostgresUrl, postgresConnectionString, resolveDatabaseUrl } from "./url";

export type Schema = typeof schema;
/** Driver-agnostic database handle: node-postgres in production, PGlite locally and in tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export function createDb(url: string): Db {
  if (isPostgresUrl(url)) {
    const pool = new Pool({ connectionString: postgresConnectionString(url), max: 10, idleTimeoutMillis: 5_000 });
    // Lets Vercel Fluid compute release idle clients before a function instance is suspended.
    attachDatabasePool(pool);
    return drizzlePg(pool, { schema });
  }
  return drizzlePglite(openPglite(url), { schema });
}

export function createPgliteDb(client: PGlite): Db {
  return drizzlePglite(client, { schema });
}

// Cached on globalThis so dev-mode module reloads and separate route bundles share one
// connection (PGlite in particular must not open the same data directory twice).
const globalForDb = globalThis as typeof globalThis & { __pheanDb?: Db };

export function getDb(): Db {
  globalForDb.__pheanDb ??= createDb(resolveDatabaseUrl());
  return globalForDb.__pheanDb;
}

/**
 * The shared database, opened on first use. For module-level singletons (like the auth
 * instance) that `next build` evaluates in several workers, where no connection should be made.
 */
export const lazyDb: Db = new Proxy({} as Db, {
  get(_target, property) {
    const db = getDb();
    const value: unknown = Reflect.get(db, property, db);
    return typeof value === "function" ? value.bind(db) : value;
  },
});
