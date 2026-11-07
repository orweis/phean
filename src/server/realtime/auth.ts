import type { Db } from "../db/client";
import { AGENT_NAME_HEADER, agentContext, authenticateAgentToken, resolveNamedSubagent, type AgentPrincipal } from "../domain/agents";
import { can } from "../domain/policy";

/** The subprotocol a stream speaks; a client that names any subprotocol must name this one first. */
export const STREAM_PROTOCOL = "phean.v1";
/**
 * For clients that cannot set an Authorization header on a WebSocket (browsers, Node's built-in
 * WebSocket), the token travels as a second subprotocol, `phean.bearer.<token>`. It is never echoed
 * back: the server selects the first offered protocol, which must be `phean.v1`.
 */
export const TOKEN_PROTOCOL_PREFIX = "phean.bearer.";

/** The bearer token a stream request carries, or why it carries none Phean will take. Never from the URL. */
export function streamToken(headers: Headers): { token: string } | { error: string; status: 400 | 401 } {
  const protocols = (headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
  // The `ws` server echoes the first offered protocol, so a token offered first would be sent back.
  if (protocols.length && protocols[0] !== STREAM_PROTOCOL) {
    return { error: `Offer the "${STREAM_PROTOCOL}" subprotocol first.`, status: 400 };
  }
  const authorization = headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    return match ? { token: match[1]! } : { error: "Authorization must be `Bearer <token>`.", status: 401 };
  }
  const offered = protocols.find((protocol) => protocol.startsWith(TOKEN_PROTOCOL_PREFIX));
  if (offered) return { token: offered.slice(TOKEN_PROTOCOL_PREFIX.length) };
  return { error: `Send your agent token as \`Authorization: Bearer <token>\`, or as the subprotocol ${TOKEN_PROTOCOL_PREFIX}<token> after ${STREAM_PROTOCOL}.`, status: 401 };
}

/**
 * Whether the agent may open the stream it asked for, through the policy matrix: reading the
 * workspace for its own events, and, as for a webhook of scope "all", managing webhooks to hear
 * everything in it.
 */
export function streamRefusal(db: Db, principal: AgentPrincipal, scope: "related" | "all"): string | null {
  const { actor } = agentContext(db, principal);
  if (!can(actor, "workspace:read")) return "This agent cannot read the workspace.";
  if (scope === "all" && !can(actor, "webhook:manage")) return 'This agent cannot listen to the whole workspace (scope "all").';
  return null;
}

/** The agent a stream request acts as: its token, and a sub-agent's name when it names one. */
export async function authenticateStream(db: Db, headers: Headers): Promise<{ principal: AgentPrincipal } | { error: string; status: 400 | 401 | 403 }> {
  const credentials = streamToken(headers);
  if ("error" in credentials) return credentials;
  const token = await authenticateAgentToken(db, credentials.token);
  if (!token) return { error: "Unknown or revoked agent token.", status: 401 };
  const named = headers.get(AGENT_NAME_HEADER);
  const principal = named ? await resolveNamedSubagent(db, token, named) : token;
  if (!principal) return { error: `The sub-agent "${named}" was revoked.`, status: 403 };
  return { principal };
}
