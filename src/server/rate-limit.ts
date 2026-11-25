import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Db } from "./db/client";
import { rateLimit } from "./db/schema";

/**
 * Counts a call against a fixed window in the shared `rate_limit` table (the one Better Auth keeps
 * its counters in, under keys of its own): true while the caller is within `max` calls a window.
 */
export async function withinRateLimit(db: Db, key: string, { window, max }: { window: number; max: number }, now = Date.now()): Promise<boolean> {
  const windowStart = now - window * 1000;
  const [row] = await db
    .insert(rateLimit)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${rateLimit.lastRequest} < ${windowStart} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${rateLimit.lastRequest} < ${windowStart} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count });
  return (row?.count ?? 1) <= max;
}

/** The client's address as the platform reports it (Vercel sets both headers), or "unknown". */
export function clientAddressOf(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
