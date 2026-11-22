import { dispatchWebhooksNow } from "@/server/entry";

/**
 * The safety net behind the after-commit kick: Vercel Cron calls this every minute to send
 * retries whose backoff has passed and anything a kick missed, and to prune old deliveries.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET only non-production
 * deployments accept the call.
 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authorized = secret ? request.headers.get("authorization") === `Bearer ${secret}` : process.env.VERCEL_ENV !== "production";
  if (!authorized) return new Response("Unauthorized", { status: 401 });

  return Response.json(await dispatchWebhooksNow());
}
