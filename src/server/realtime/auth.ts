import { AGENT_TOKEN_PREFIX } from "@/lib/domain";

import { verifyOAuthToken as verifyDeploymentToken, type OAuthTokenVerifier } from "../auth/oauth";
import { mcpResourceTarget } from "../config";
import type { Db } from "../db/client";
import { AGENT_NAME_HEADER, agentContext, authenticateAgentToken, resolveNamedSubagent, resolveOAuthAgent, type AgentPrincipal } from "../domain/agents";
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

/**
 * The MCP endpoint an access token says it was issued for, read before it is verified, when that is
 * one of this deployment's; the verifier then holds the token to exactly that audience. The stream
 * belongs to the same protected resource as the MCP endpoints, so a token for `/mcp`, or for the
 * agent's own workspace URL, opens it.
 */
function claimedResource(token: string): { audience: string; slug: string | null } | null {
  try {
    const { aud } = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as { aud?: unknown };
    if (typeof aud !== "string") return null;
    const target = mcpResourceTarget(aud);
    return target && { audience: aud, slug: target.slug };
  } catch {
    return null;
  }
}

/** The agent an OAuth access token names, when it verifies for the endpoint it claims and that endpoint's workspace, if it names one, is the agent's. */
async function oauthPrincipal(db: Db, token: string, verify: OAuthTokenVerifier): Promise<StreamAuth | null> {
  const resource = claimedResource(token);
  if (!resource) return null;
  const verified = await verify(token, resource.audience);
  const principal = verified && (await resolveOAuthAgent(db, verified.agentId, verified));
  if (!verified || !principal || (resource.slug !== null && principal.tenant.slug !== resource.slug)) return null;
  return { principal, tokenExpiresAt: new Date(verified.expiresAt * 1000) };
}

export interface StreamAuth {
  principal: AgentPrincipal;
  /** When an OAuth access token runs out: the stream ends by then, and the agent reconnects with a fresh one. */
  tokenExpiresAt?: Date;
}

/**
 * The agent a stream request acts as: a fixed `phn_` key or an OAuth access token, held to the same
 * checks as at the MCP endpoint, and a sub-agent's name when it names one.
 */
export async function authenticateStream(
  db: Db,
  headers: Headers,
  { verifyOAuthToken = verifyDeploymentToken }: { verifyOAuthToken?: OAuthTokenVerifier } = {},
): Promise<StreamAuth | { error: string; status: 400 | 401 | 403 }> {
  const credentials = streamToken(headers);
  if ("error" in credentials) return credentials;
  const authenticated: StreamAuth | null = credentials.token.startsWith(AGENT_TOKEN_PREFIX)
    ? await authenticateAgentToken(db, credentials.token).then((principal) => principal && { principal })
    : await oauthPrincipal(db, credentials.token, verifyOAuthToken);
  if (!authenticated) return { error: "Unknown, expired or revoked agent token.", status: 401 };
  const named = headers.get(AGENT_NAME_HEADER);
  const principal = named ? await resolveNamedSubagent(db, authenticated.principal, named) : authenticated.principal;
  if (!principal) return { error: `The sub-agent "${named}" was revoked.`, status: 403 };
  return { ...authenticated, principal };
}
