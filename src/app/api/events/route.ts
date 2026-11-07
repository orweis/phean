import { getDeadline, upgradeWebSocket, waitUntil } from "@vercel/functions";
import { getPublicOrigin } from "mcp-handler";

import { getDb } from "@/server/db/client";
import { authenticateStream, streamRefusal } from "@/server/realtime/auth";
import { parseStreamOptions, runEventStream, STREAM_LIMITS, type StreamSocket } from "@/server/realtime/stream";

export const dynamic = "force-dynamic";
// Each stream ends itself (STREAM_LIMITS.lifetimeMs) before this, asking the agent to reconnect.
export const maxDuration = 300;

const problem = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

/**
 * The realtime event stream for agents: a WebSocket that pushes the events the agent's webhook
 * would get. Authenticates before upgrading, so an unauthenticated request never gets a socket.
 */
export async function GET(request: Request): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return problem(426, "Connect with a WebSocket client: wss://<this host>/api/events, with your agent token in the Authorization header.");
  }
  const db = getDb();
  const auth = await authenticateStream(db, request.headers);
  if ("error" in auth) return problem(auth.status, auth.error);
  const options = parseStreamOptions(new URL(request.url));
  if ("error" in options) return problem(400, options.error);
  const refusal = streamRefusal(db, auth.principal, options.scope);
  if (refusal) return problem(403, refusal);
  const origin = getPublicOrigin(request);

  try {
    return await upgradeWebSocket(
      (socket) => {
        // The stream outlives this handler; keep the function alive until the socket closes.
        waitUntil(runEventStream(socket as unknown as StreamSocket, { db, principal: auth.principal, options, origin, deadline: getDeadline(), tokenExpiresAt: auth.tokenExpiresAt }));
      },
      { maxPayload: STREAM_LIMITS.maxClientMessage },
    );
  } catch (error) {
    // Only a runtime without upgrades is a 501; anything else is a handshake the client got wrong.
    // The package's own wording for a runtime without upgrades (and for a missing `ws`, a deployment fault too).
    if (error instanceof Error && /not available in the current runtime|"ws" package is required/.test(error.message)) {
      return problem(501, "This deployment cannot hold WebSockets. Use a webhook (register_webhook) or wait_for_answers instead.");
    }
    console.warn("[realtime] handshake failed", error);
    return problem(400, "The WebSocket handshake failed. Check the Sec-WebSocket-Key and that your token is sent as described.");
  }
}
