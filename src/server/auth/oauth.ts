import { verifyJwsAccessToken } from "better-auth/oauth2";

import { appUrl, mcpResourceUrl } from "../config";
import { auth, type Auth } from "./auth";

export type OAuthTokenVerifier = (token: string) => Promise<{ agentId: string } | null>;

/**
 * Checks signature, issuer, audience, expiry and type locally against the provider's keys. It only
 * says which agent the token names: whether that agent is live, and in which workspace, is the
 * `agents` row's answer, so a token's claims never choose a tenant.
 */
export function createOAuthVerifier(provider: Pick<Auth, "api">, expected: { issuer: string; audience: string }): OAuthTokenVerifier {
  return async (token) => {
    const payload = await verifyJwsAccessToken(token, {
      jwksFetch: () => provider.api.getJwks(),
      verifyOptions: { ...expected, typ: "at+jwt" },
    }).catch(() => null);
    if (!payload || payload.cnf || typeof payload.agent_id !== "string") return null;
    return { agentId: payload.agent_id };
  };
}

/** Verifies a token issued by this deployment, for this deployment's MCP endpoint. */
export const verifyOAuthToken: OAuthTokenVerifier = (token) =>
  createOAuthVerifier(auth, { issuer: `${appUrl()}/api/auth`, audience: mcpResourceUrl() })(token);
