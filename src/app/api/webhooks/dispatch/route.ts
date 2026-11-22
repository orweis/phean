import { dispatchPushesNow, dispatchWebhooksNow } from "@/server/entry";

/**
 * The safety net behind the after-commit kick: Vercel Cron calls this every minute to send
 * retries whose backoff has passed and anything a kick missed, and to prune old deliveries. Decision
 * notifications ride the same sweep.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET only non-production
 * deployments accept the call.
 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authorized = secret ? request.headers.get("authorization") === `Bearer ${secret}` : process.env.VERCEL_ENV !== "production";
  if (!authorized) return new Response("Unauthorized", { status: 401 });

  const report = await dispatchWebhooksNow();
  const push = await dispatchPushesNow();
  return Response.json({ ...report, push });
}
