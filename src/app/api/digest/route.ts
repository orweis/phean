import { emailConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { sendDueDigests } from "@/server/digest/send";

/**
 * Vercel Cron calls this every hour to email the morning digests whose hour it is in their
 * person's time zone. Authorized like the webhook dispatcher: `Authorization: Bearer $CRON_SECRET`,
 * or any caller on a non-production deployment without one. Without email set up it sends nothing.
 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authorized = secret ? request.headers.get("authorization") === `Bearer ${secret}` : process.env.VERCEL_ENV !== "production";
  if (!authorized) return new Response("Unauthorized", { status: 401 });
  if (!emailConfig()) return Response.json({ skipped: "Email is not set up: set RESEND_API_KEY and PHEAN_EMAIL_FROM." });
  return Response.json(await sendDueDigests(getDb()));
}
