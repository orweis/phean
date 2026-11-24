import { rollUpUsageIfDue, sweepPipelinesNow } from "@/server/entry";

/**
 * Vercel Cron calls this every minute: it applies pipelines' time limits (a person stop's reminder
 * half way, its default at the limit; an agent stop that ran out of time fails) and starts the runs
 * schedules call for. Once an hour it also rolls usage up for the backoffice (`rollUpUsageIfDue`). Authorized like the other cron routes: `Authorization: Bearer $CRON_SECRET`,
 * or any caller on a non-production deployment without one.
 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authorized = secret ? request.headers.get("authorization") === `Bearer ${secret}` : process.env.VERCEL_ENV !== "production";
  if (!authorized) return new Response("Unauthorized", { status: 401 });
  const sweep = await sweepPipelinesNow();
  const rollup = await rollUpUsageIfDue();
  return Response.json({ ...sweep, rollup });
}
