import { getSession } from "@/server/auth/session";
import { trustedOrigins } from "@/server/config";
import { getDb } from "@/server/db/client";
import { handleInbox } from "@/server/push/http";

export const dynamic = "force-dynamic";

/**
 * The desktop's feed of open requests across the person's workspaces (docs/apps/CONTRACTS.md,
 * "Inbox feed"): the session cookie, Phean-Client, ETag and 304, never cached, no CORS.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  return handleInbox(request, { db: getDb(), person: session ? { id: session.user.id, name: session.user.name } : null, origins: trustedOrigins() });
}

/** No preflight is ever answered, so no other origin can send the custom header. */
export function OPTIONS(): Response {
  return new Response(null, { status: 405, headers: { allow: "GET" } });
}
