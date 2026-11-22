import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Whether a call to a cron route (`/api/webhooks/dispatch`, `/api/digest`) may run.
 *
 * With `CRON_SECRET` set, the caller must send `Authorization: Bearer $CRON_SECRET`, which is what
 * Vercel Cron sends; the comparison takes the same time whatever the guess. Without it the routes
 * fail closed: only a local development server (not a production build, not on Vercel) accepts the
 * call, so a self-hosted or preview deployment that forgot the secret is not open to the internet.
 * "Local development" means `NODE_ENV` is explicitly `development` or `test`: an unset or unknown
 * `NODE_ENV` counts as a deployment and fails closed too.
 */
export function isAuthorizedCronRequest(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return isLocalDevelopment(env);
  const header = request.headers.get("authorization");
  if (!header) return false;
  // Hash both sides so the buffers have equal length and the compare leaks nothing about the size.
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

function isLocalDevelopment(env: NodeJS.ProcessEnv): boolean {
  const devNodeEnv = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  return devNodeEnv && (!env.VERCEL_ENV || env.VERCEL_ENV === "development");
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** The response a cron route sends a caller `isAuthorizedCronRequest` refused. */
export function unauthorizedCron(): Response {
  return new Response("Unauthorized", { status: 401 });
}
