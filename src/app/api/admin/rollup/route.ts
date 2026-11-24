import { rollUpUsageNow } from "@/server/entry";

/**
 * Runs the backoffice's usage rollup on demand (the pipelines tick runs it hourly): it rolls the event log up into `usage_daily`, the per-day counts
 * the backoffice reads, from the last day it finished through yesterday (today is read live).
 * Authorized like the other cron routes: `Authorization: Bearer $CRON_SECRET`, or any caller on a
 * non-production deployment without one.
 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authorized = secret ? request.headers.get("authorization") === `Bearer ${secret}` : process.env.VERCEL_ENV !== "production";
  if (!authorized) return new Response("Unauthorized", { status: 401 });
  return Response.json(await rollUpUsageNow());
}
