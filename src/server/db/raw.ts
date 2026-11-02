import { sql, type SQL } from "drizzle-orm";

import type { Db } from "./client";

/** `count(*) filter (where ...)` as a number, for several counts in one grouped query. */
export const countWhere = (condition: SQL) => sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

/** Runs raw SQL and returns its rows; both node-postgres and PGlite results expose `rows`. */
export async function queryRows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] };
  return result.rows;
}
