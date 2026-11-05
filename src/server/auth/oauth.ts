import { verifyJwsAccessToken } from "better-auth/oauth2";

import { appUrl, mcpResourceUrl } from "../config";
import { auth, type Auth } from "./auth";

/** `audience` is the endpoint the token was sent to; it defaults to the one the verifier was made for. */
export type OAuthTokenVerifier = (token: string, audience?: string) => Promise<VerifiedOAuthToken | null>;

export interface VerifiedOAuthToken {
  agentId: string;
  /** The token's `iat`, in seconds: a token from before the agent's last renewal is refused. */
  issuedAt: number;
}

/** JOSE errors that mean the keys couldn't be read, not that the token is bad. */
const KEY_SET_FAILURES = new Set(["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JWKS_MULTIPLE_MATCHING_KEYS"]);

/**
 * A JOSE error about the token itself: malformed, badly signed, expired, wrong claims, unknown key.
 * Matched by code rather than class, since more than one copy of `jose` may be installed. A header
 * that isn't base64url JSON is a TypeError from `jose`; the key fetch turns its own TypeErrors into
 * plain errors, so a TypeError here is always about the token, as Better Auth's own verifier assumes.
 */
function isRejectedToken(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
  return typeof code === "string" && /^ERR_J(OSE|WT|WS|WK)/.test(code) && !KEY_SET_FAILURES.has(code);
}

/**
 * Checks signature, issuer, audience, expiry and type locally against the provider's keys. It only
 * says which agent the token names: whether that agent is live, and in which workspace, is the
 * `agents` row's answer, so a token's claims never choose a tenant.
 */
export function createOAuthVerifier(provider: Pick<Auth, "api">, expected: { issuer: string; audience: string }): OAuthTokenVerifier {
  return async (token, audience = expected.audience) => {
    const payload = await verifyJwsAccessToken(token, {
      jwksFetch: () => provider.api.getJwks(),
      verifyOptions: { issuer: expected.issuer, audience, typ: "at+jwt" },
    }).catch((error: unknown) => {
      if (isRejectedToken(error)) return null;
      throw error;
    });
    if (!payload || payload.cnf || typeof payload.agent_id !== "string" || typeof payload.iat !== "number") return null;
    return { agentId: payload.agent_id, issuedAt: payload.iat };
  };
}

/** Verifies a token issued by this deployment, for one of this deployment's MCP endpoints. */
export const verifyOAuthToken: OAuthTokenVerifier = (token, audience) =>
  createOAuthVerifier(auth, { issuer: `${appUrl()}/api/auth`, audience: mcpResourceUrl() })(token, audience);
