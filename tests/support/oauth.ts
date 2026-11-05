import { createHash, randomBytes } from "node:crypto";

import { vi } from "vitest";

import { completeConsent, createAuth, type Auth } from "@/server/auth/auth";
import { createOAuthVerifier } from "@/server/auth/oauth";
import { mcpResourceUrl } from "@/server/config";
import type { Db } from "@/server/db/client";
import { approveAgent } from "@/server/domain/agents";
import type { Ctx, Tenant } from "@/server/domain/context";
import { createPheanMcpHandler } from "@/server/mcp/handler";

import { addMember, asUser, seedTenant, type TestUser } from "./db";

/** The provider refuses plain HTTP off loopback, so these tests can't use TEST_ORIGIN. */
export const OAUTH_BASE = "http://localhost:3200";
export const OAUTH_ISSUER = `${OAUTH_BASE}/api/auth`;
export const OAUTH_RESOURCE = `${OAUTH_BASE}/mcp`;
export const REDIRECT_URI = "http://127.0.0.1:43123/callback";
const SCOPE = "phean:read phean:write offline_access";

export interface OAuthServer {
  baseUrl: string;
  auth: Auth;
  handler: (request: Request) => Promise<Response>;
}

/** The real provider and the real MCP handler on one test database. Call `vi.unstubAllEnvs()` after the test. */
export function createOAuthServer(db: Db, baseUrl = OAUTH_BASE): OAuthServer {
  vi.stubEnv("BETTER_AUTH_URL", baseUrl);
  vi.stubEnv("BETTER_AUTH_SECRET", "phean-oauth-tests-only-secret-0123456789");
  const auth = createAuth(db, baseUrl);
  const verifyOAuthToken = createOAuthVerifier(auth, { issuer: `${baseUrl}/api/auth`, audience: mcpResourceUrl() });
  return { baseUrl, auth, handler: createPheanMcpHandler({ getDb: () => db, verifyOAuthToken }) };
}

export function jsonPost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

export interface SignedIn {
  person: TestUser;
  tenant: Tenant;
  ctx: Ctx;
  cookie: string;
}

/** A person with a real password session, owning a workspace of their own. */
export async function signUpOwner(db: Db, { auth, baseUrl }: OAuthServer, slug: string): Promise<SignedIn> {
  const email = `${randomBytes(6).toString("hex")}@example.com`;
  const response = await auth.handler(jsonPost(`${baseUrl}/api/auth/sign-up/email`, { name: "Dana", email, password: "correct-horse-battery" }));
  if (!response.ok) throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
  const { user } = (await response.json()) as { user: { id: string } };
  const cookie = response.headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");
  const person = { id: user.id, name: "Dana", email };
  const tenant = await seedTenant(db, `${slug}-${randomBytes(4).toString("hex")}`, slug);
  await addMember(db, tenant, person, "owner");
  return { person, tenant, ctx: asUser(db, tenant, person), cookie };
}

export function registerClient({ auth, baseUrl }: OAuthServer, overrides: Record<string, unknown> = {}): Promise<Response> {
  return auth.handler(
    jsonPost(`${baseUrl}/api/auth/oauth2/register`, {
      client_name: "Test Client",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...overrides,
    }),
  );
}

export async function registerClientId(server: OAuthServer): Promise<string> {
  const response = await registerClient(server);
  if (!response.ok) throw new Error(`register failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { client_id: string }).client_id;
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function authorizeRequest({ baseUrl }: OAuthServer, cookie: string, clientId: string, challenge: string, overrides: Record<string, string> = {}): Request {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state: "state-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${baseUrl}/mcp`,
    ...overrides,
  });
  return new Request(`${baseUrl}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } });
}

/** Runs authorize for a signed-in person, up to the signed query the dialog receives. */
export async function authorize(server: OAuthServer, cookie: string, clientId: string, challenge: string): Promise<string> {
  const response = await server.auth.handler(authorizeRequest(server, cookie, clientId, challenge));
  const location = response.headers.get("location");
  if (!location) throw new Error(`authorize did not redirect: ${response.status} ${await response.text()}`);
  const url = new URL(location, server.baseUrl);
  if (url.pathname !== "/oauth/approve") throw new Error(`authorize went to ${location}`);
  return url.search.slice(1);
}

function tokenRequest({ baseUrl }: OAuthServer, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(`${baseUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });
}

export function redeem(server: OAuthServer, clientId: string, code: string, verifier?: string, headers: Record<string, string> = {}): Promise<Response> {
  return server.auth.handler(
    tokenRequest(
      server,
      { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT_URI, resource: `${server.baseUrl}/mcp`, ...(verifier && { code_verifier: verifier }) },
      headers,
    ),
  );
}

export function refresh(server: OAuthServer, clientId: string, refreshToken: string): Promise<Response> {
  return server.auth.handler(tokenRequest(server, { grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }));
}

export interface Approved extends SignedIn {
  clientId: string;
  agentId: string;
  code: string;
  verifier: string;
  /** Where the consent call sent the browser back to. */
  callback: URL;
}

/** What the client and the dialog do up to handing back a code: register, authorize, approve, consent. */
export async function approveClient(db: Db, server: OAuthServer, slug: string, name = "Laptop"): Promise<Approved> {
  const signedIn = await signUpOwner(db, server, slug);
  const clientId = await registerClientId(server);
  const { verifier, challenge } = pkce();
  const oauthQuery = await authorize(server, signedIn.cookie, clientId, challenge);
  const { agent } = await approveAgent(signedIn.ctx, { name, level: "write", lifetimeDays: 30, oauthClientId: clientId });
  const { url } = await completeConsent(server.auth, new Headers({ cookie: signedIn.cookie }), { agentId: agent.id, oauthQuery });
  const callback = new URL(url);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error(`consent returned no code: ${url}`);
  return { ...signedIn, clientId, agentId: agent.id, code, verifier, callback };
}

export interface Connected extends Approved {
  accessToken: string;
  refreshToken: string;
}

/** The whole flow, ending with the client holding its tokens. */
export async function connectOAuthAgent(db: Db, server: OAuthServer, slug: string, name = "Laptop"): Promise<Connected> {
  const approved = await approveClient(db, server, slug, name);
  const response = await redeem(server, approved.clientId, approved.code, approved.verifier);
  const tokens = (await response.json()) as { access_token: string; refresh_token?: string };
  if (!response.ok || !tokens.refresh_token) throw new Error(`token exchange failed: ${response.status} ${JSON.stringify(tokens)}`);
  return { ...approved, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}
