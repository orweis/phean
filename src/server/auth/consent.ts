import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";

import { authorizeRetryPath, redirectTarget, type RedirectTarget } from "@/lib/oauth-consent";

import { mcpResourceUrl } from "../config";
import type { Auth } from "./auth";

export type ConsentRequest =
  | { status: "ok"; clientId: string; redirectUri: string; target: RedirectTarget; scope: string | null }
  /** Past its time limit: authorize signs a new one. */
  | { status: "stale"; retryPath: string }
  | { status: "invalid" };

/**
 * The signed query the provider sends to the dialog, checked before anything is shown or done.
 * The library's check says only "no" for an expired or a forged query, so `exp` tells them apart.
 * A forger who backdates `exp` gets only a re-run of authorize, which checks everything itself.
 */
export async function readConsentRequest(provider: Auth, oauthQuery: string): Promise<ConsentRequest> {
  const params = new URLSearchParams(oauthQuery);
  const expiresAt = Number(params.get("exp"));
  if (!params.has("sig") || !Number.isFinite(expiresAt)) return { status: "invalid" };
  if (expiresAt * 1000 < Date.now()) return { status: "stale", retryPath: authorizeRetryPath(oauthQuery) };

  const { secret } = await provider.$context;
  if (!(await verifyOAuthQueryParams(oauthQuery, secret))) return { status: "invalid" };

  // Without this resource the token could not be used at /mcp, and the person would approve for nothing.
  const resources = params.getAll("resource");
  if (resources.length !== 1 || resources[0] !== mcpResourceUrl()) return { status: "invalid" };

  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const target = redirectUri ? redirectTarget(redirectUri) : null;
  if (!clientId || !redirectUri || !target) return { status: "invalid" };
  return { status: "ok", clientId, redirectUri, target, scope: params.get("scope") };
}
