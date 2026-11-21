import { getSession, requireWorkspace } from "@/server/auth/session";
import { trustedOrigins } from "@/server/config";
import { handlePushAnswer } from "@/server/push/http";

export const dynamic = "force-dynamic";

/**
 * A notification's answer (docs/apps/CONTRACTS.md, "Answering from a notification"). The workspace
 * comes only from the session (`requireWorkspace`, 404 for one the person is not in); the request
 * must carry Phean-Client and JSON, and a browser's Origin must be Phean's.
 */
export async function POST(request: Request, { params }: RouteContext<"/w/[slug]/push/answer">): Promise<Response> {
  const { slug } = await params;
  return handlePushAnswer(request, async () => ((await getSession()) ? (await requireWorkspace(slug)).ctx : null), { origins: trustedOrigins() });
}

/** No preflight is ever answered, so no other origin can send the custom header. */
export function OPTIONS(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
