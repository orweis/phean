import { sql } from "drizzle-orm";

import type { Db } from "./client";

/** One round trip to the database: true when it answers. */
export async function pingDatabase(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (error) {
    console.error("Database ping failed", error);
    return false;
  }
}
