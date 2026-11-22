import { databaseReachable } from "@/server/entry";

export const dynamic = "force-dynamic";

/** Liveness plus a database round trip, for uptime checks and post-deploy smoke tests. */
export async function GET() {
  const started = performance.now();
  if (!(await databaseReachable())) return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  return Response.json({ status: "ok", database: "ok", latencyMs: Math.round(performance.now() - started) });
}
