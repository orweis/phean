import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** Liveness plus a database round trip, for uptime checks and post-deploy smoke tests. */
export async function GET() {
  const started = performance.now();
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok", database: "ok", latencyMs: Math.round(performance.now() - started) });
  } catch (error) {
    console.error("Health check failed", error);
    return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
