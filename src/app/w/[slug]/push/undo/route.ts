import { getSession, requireWorkspace } from "@/server/auth/session";
import { trustedOrigins } from "@/server/config";
import { handlePushUndo } from "@/server/push/http";

export const dynamic = "force-dynamic";

/** Undo on a notification's "Sent" receipt: takes the answer back until the agent has collected it. */
export async function POST(request: Request, { params }: RouteContext<"/w/[slug]/push/undo">): Promise<Response> {
  const { slug } = await params;
  return handlePushUndo(request, async () => ((await getSession()) ? (await requireWorkspace(slug)).ctx : null), { origins: trustedOrigins() });
}

/** No preflight is ever answered, so no other origin can send the custom header. */
export function OPTIONS(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
