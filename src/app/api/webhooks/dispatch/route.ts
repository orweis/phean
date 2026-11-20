import { isAuthorizedCronRequest, unauthorizedCron } from "@/server/cron-auth";
import { getDb } from "@/server/db/client";
import { dispatchDue, pruneDeliveries } from "@/server/webhooks/dispatch";

/**
 * The safety net behind the after-commit kick: Vercel Cron calls this every minute to send
 * retries whose backoff has passed and anything a kick missed, and to prune old deliveries.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET only a local development
 * server accepts the call (see `isAuthorizedCronRequest`).
 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) return unauthorizedCron();

  const db = getDb();
  const report = await dispatchDue(db);
  await pruneDeliveries(db);
  return Response.json(report);
}
