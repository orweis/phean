import { emailConfig } from "@/server/config";
import { isAuthorizedCronRequest, unauthorizedCron } from "@/server/cron-auth";
import { getDb } from "@/server/db/client";
import { sendDueDigests } from "@/server/digest/send";

/**
 * Vercel Cron calls this every hour to email the morning digests whose hour it is in their
 * person's time zone. Authorized like the webhook dispatcher (`isAuthorizedCronRequest`):
 * `Authorization: Bearer $CRON_SECRET`, or any caller to a local development server without one.
 * Without email set up it sends nothing.
 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) return unauthorizedCron();
  if (!emailConfig()) return Response.json({ skipped: "Email is not set up: set RESEND_API_KEY and PHEAN_EMAIL_FROM." });
  return Response.json(await sendDueDigests(getDb()));
}
