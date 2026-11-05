import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { authRouteHandler, authServerMetadataRoute, completeConsent, workspaceResourceMetadata } from "@/server/auth/auth";
import { readConsentRequest } from "@/server/auth/consent";
import { OAUTH_AUTHORIZE_LIMIT, pruneUnusedClients, UNUSED_CLIENT_HOURS } from "@/server/auth/clients";
import { createOAuthVerifier } from "@/server/auth/oauth";
import { agents, member, oauthClient, oauthConsent, oauthRefreshToken } from "@/server/db/schema";
import { approveAgent, createAgent, resolveOAuthAgent, revokeAgent } from "@/server/domain/agents";
import { createPheanMcpHandler } from "@/server/mcp/handler";

import { createTestDb, seedWorkspace, type TestDb } from "./support/db";
import { connectMcpClient, dataOf } from "./support/mcp";
import {
  approveClient,
  authorize,
  authorizeRequest,
  connectOAuthAgent,
  createOAuthServer,
  jsonPost,
  OAUTH_BASE,
  OAUTH_ISSUER,
  OAUTH_RESOURCE,
  pkce,
  redeem,
  REDIRECT_URI,
  refresh,
  registerClient,
  registerClientId,
  signUpOwner,
  type OAuthServer,
  type SignedIn,
} from "./support/oauth";

let testDb: TestDb;
let server: OAuthServer;

const initialize = (token?: string, url = OAUTH_RESOURCE, headers: Record<string, string> = {}) =>
  server.handler(
    jsonPost(
      url,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
      { accept: "application/json, text/event-stream", ...(token && { authorization: `Bearer ${token}` }), ...headers },
    ),
  );

async function whoami(token: string, options: { agentName?: string } = {}) {
  const client = await connectMcpClient(server.handler, token, { url: OAUTH_RESOURCE, ...options });
  try {
    return dataOf<{ agent: { id: string; name: string }; workspace: { id: string } }>(await client.callTool({ name: "whoami", arguments: {} }));
  } finally {
    await client.close();
  }
}

const refreshRows = (agentId: string) => testDb.db.select({ id: oauthRefreshToken.id }).from(oauthRefreshToken).where(eq(oauthRefreshToken.referenceId, agentId));

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(() => {
  server = createOAuthServer(testDb.db);
});

afterEach(() => vi.unstubAllEnvs());

afterAll(() => testDb.close());

describe("discovery", () => {
  it("no token: 401 naming the resource metadata", async () => {
    const response = await initialize();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${OAUTH_BASE}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("the challenge names the real URL under a spoofed forwarded host", async () => {
    const response = await initialize(undefined, OAUTH_RESOURCE, { "x-forwarded-host": "evil.example" });
    expect(response.headers.get("www-authenticate")).toContain(OAUTH_BASE);
    expect(response.headers.get("www-authenticate")).not.toContain("evil.example");
  });

  it("protected resource metadata lists the authorization server", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const response = await server.auth.handler(new Request(`${OAUTH_BASE}${path}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ resource: OAUTH_RESOURCE, authorization_servers: [OAUTH_ISSUER] });
    }
  });

  it("authorization server metadata", async () => {
    const response = await authServerMetadataRoute(server.auth)(new Request(`${OAUTH_BASE}/.well-known/oauth-authorization-server/api/auth`));
    expect(await response.json()).toMatchObject({
      issuer: OAUTH_ISSUER,
      code_challenge_methods_supported: ["S256"],
      registration_endpoint: `${OAUTH_ISSUER}/oauth2/register`,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  it("advertises only the token auth methods registration accepts", async () => {
    const response = await authServerMetadataRoute(server.auth)(new Request(`${OAUTH_BASE}/.well-known/oauth-authorization-server/api/auth`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    // private_key_jwt stays for CIMD clients, which authenticate with their published keys.
    expect(((await response.json()) as { token_endpoint_auth_methods_supported: string[] }).token_endpoint_auth_methods_supported).toEqual(["none", "private_key_jwt"]);
    // The provider also answers under its own base path.
    const nested = await authRouteHandler(server.auth)(new Request(`${OAUTH_ISSUER}/.well-known/oauth-authorization-server`));
    expect(((await nested.json()) as { token_endpoint_auth_methods_supported: string[] }).token_endpoint_auth_methods_supported).toEqual(["none", "private_key_jwt"]);
  });
});

describe("registering a client", () => {
  it("open DCR registers a public native client on a loopback redirect", async () => {
    // No application_type: the "infer" default must allow a loopback redirect.
    const response = await registerClient(server);
    expect(response.ok).toBe(true);
    const client = (await response.json()) as { client_id: string; client_secret?: string; token_endpoint_auth_method: string };
    expect(client.client_id).toBeTruthy();
    expect(client.client_secret).toBeUndefined();
    expect(client.token_endpoint_auth_method).toBe("none");
  });

  it("DCR registers a client that names no auth method as public, and says so", async () => {
    // RFC 7591 3.2.1 lets the server replace requested metadata; the response is what the client must use.
    const response = await registerClient(server, { token_endpoint_auth_method: undefined });
    expect(response.status).toBe(201);
    const client = (await response.json()) as { client_id: string; client_secret?: string; token_endpoint_auth_method: string };
    expect(client.token_endpoint_auth_method).toBe("none");
    expect(client.client_secret).toBeUndefined();
    const [row] = await testDb.db.select().from(oauthClient).where(eq(oauthClient.clientId, client.client_id));
    expect(row?.tokenEndpointAuthMethod).toBe("none");
    expect(row?.clientSecret ?? null).toBeNull();
  });

  it("DCR refuses a confidential client without credentials", async () => {
    const before = await testDb.db.select({ id: oauthClient.id }).from(oauthClient);
    for (const method of ["client_secret_basic", "client_secret_post", "client_secret_jwt"]) {
      const response = await registerClient(server, { token_endpoint_auth_method: method });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_client_metadata" });
    }
    expect(await testDb.db.select({ id: oauthClient.id }).from(oauthClient)).toHaveLength(before.length);
  });

  it("holds authorize, where a CIMD client is fetched and stored before sign-in, to a limit of its own", () => {
    const authorizeRule = server.auth.options.plugins.flatMap((plugin) => ("rateLimit" in plugin ? (plugin.rateLimit ?? []) : [])).find((rule) => rule.pathMatcher("/oauth2/authorize"));
    expect(authorizeRule).toMatchObject({ window: 60, max: OAUTH_AUTHORIZE_LIMIT });
  });

  it("holds the register route to the built-in limit unless raised", () => {
    const registerLimit = ({ auth }: OAuthServer) =>
      auth.options.plugins.flatMap((plugin) => ("rateLimit" in plugin ? (plugin.rateLimit ?? []) : [])).find((rule) => rule.pathMatcher("/oauth2/register"))?.max;
    expect(registerLimit(server)).toBe(5);
    vi.stubEnv("PHEAN_OAUTH_REGISTER_LIMIT", "500");
    expect(registerLimit(createOAuthServer(testDb.db))).toBe(500);
  });
});

describe("clients never used", () => {
  const clientIds = async () => (await testDb.db.select({ clientId: oauthClient.clientId }).from(oauthClient)).map((row) => row.clientId);
  const age = (clientId: string, hours: number) => {
    const at = new Date(Date.now() - hours * 60 * 60 * 1000);
    return testDb.db.update(oauthClient).set({ createdAt: at, updatedAt: at }).where(eq(oauthClient.clientId, clientId));
  };

  it("are removed after a day, unless they hold a consent or a token", async () => {
    const stale = await registerClientId(server);
    const recent = await registerClientId(server);
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    const tokenOnly = await connectOAuthAgent(testDb.db, server, "globex");
    await testDb.db.delete(oauthConsent).where(eq(oauthConsent.clientId, tokenOnly.clientId));
    for (const clientId of [stale, connected.clientId, tokenOnly.clientId]) await age(clientId, UNUSED_CLIENT_HOURS + 1);
    await age(recent, UNUSED_CLIENT_HOURS - 1);

    await pruneUnusedClients(testDb.db);
    const left = await clientIds();
    expect(left).not.toContain(stale);
    expect(left).toEqual(expect.arrayContaining([recent, connected.clientId, tokenOnly.clientId]));
    expect((await refresh(server, connected.clientId, connected.refreshToken)).status).toBe(200);
  });

  it("are removed a bounded batch at a time", async () => {
    const stale = [await registerClientId(server), await registerClientId(server), await registerClientId(server)];
    for (const clientId of stale) await age(clientId, UNUSED_CLIENT_HOURS + 1);
    await pruneUnusedClients(testDb.db, 2);
    expect((await clientIds()).filter((clientId) => stale.includes(clientId))).toHaveLength(1);
  });

  it("are removed when a new client registers", async () => {
    const stale = await registerClientId(server);
    await age(stale, UNUSED_CLIENT_HOURS + 1);
    const fresh = await registerClientId(server);
    const left = await clientIds();
    expect(left).not.toContain(stale);
    expect(left).toContain(fresh);
  });
});

describe("authorizing", () => {
  it("the authorize response carries iss, on success and on cancel", async () => {
    const { auth } = server;
    const approved = await approveClient(testDb.db, server, "acme");
    expect(approved.callback.searchParams.get("iss")).toBe(OAUTH_ISSUER);
    expect(approved.callback.searchParams.get("state")).toBe("state-1");

    const oauthQuery = await authorize(server, approved.cookie, approved.clientId, pkce().challenge);
    const { url } = await completeConsent(auth, new Headers({ cookie: approved.cookie }), { agentId: null, oauthQuery });
    expect(new URL(url).searchParams.get("error")).toBe("access_denied");
    expect(new URL(url).searchParams.get("iss")).toBe(OAUTH_ISSUER);
  });

  it("every authorize shows the dialog again, even after an earlier consent", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    await expect(authorize(server, connected.cookie, connected.clientId, pkce().challenge)).resolves.toContain("sig=");
  });

  it("consent can't be posted to the provider directly", async () => {
    const { person, cookie } = await signUpOwner(testDb.db, server, "acme");
    const oauthQuery = await authorize(server, cookie, await registerClientId(server), pkce().challenge);
    const response = await server.auth.handler(jsonPost(`${OAUTH_ISSUER}/oauth2/consent`, { accept: true, oauth_query: oauthQuery }, { cookie }));
    expect(response.status).toBe(404);
    expect(await testDb.db.select({ id: oauthConsent.id }).from(oauthConsent).where(eq(oauthConsent.userId, person.id))).toEqual([]);
  });

  it("a session can't mint a token at /token", async () => {
    const { cookie } = await signUpOwner(testDb.db, server, "acme");
    const response = await server.auth.handler(new Request(`${OAUTH_ISSUER}/token`, { headers: { cookie } }));
    expect(response.status).toBe(404);
  });

  it("a code exchange without the PKCE verifier fails", async () => {
    const approved = await approveClient(testDb.db, server, "acme");
    expect((await redeem(server, approved.clientId, approved.code)).status).toBe(400);
  });

  it("refuses to authorize for another resource", async () => {
    const { cookie } = await signUpOwner(testDb.db, server, "acme");
    const clientId = await registerClientId(server);
    const response = await server.auth.handler(authorizeRequest(server, cookie, clientId, pkce().challenge, { resource: `${OAUTH_BASE}/other` }));
    expect(response.headers.get("location")).toContain("invalid_target");
  });

  it("the first code exchange fails when the agent lost access in between", async () => {
    const approved = await approveClient(testDb.db, server, "acme");
    await revokeAgent(approved.ctx, { agentId: approved.agentId });
    const response = await redeem(server, approved.clientId, approved.code, approved.verifier);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
    expect(await refreshRows(approved.agentId)).toEqual([]);
  });

  it("a key's agent can't be turned into an OAuth one through consent", async () => {
    const { ctx, cookie } = await signUpOwner(testDb.db, server, "acme");
    const { agent } = await createAgent(ctx, { name: "Keyed" });
    const clientId = await registerClientId(server);
    const { verifier, challenge } = pkce();
    const { url } = await completeConsent(server.auth, new Headers({ cookie }), { agentId: agent.id, oauthQuery: await authorize(server, cookie, clientId, challenge) });
    const response = await redeem(server, clientId, new URL(url).searchParams.get("code")!, verifier);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("a DPoP proof is refused rather than binding a token Phean can't honour", async () => {
    const approved = await approveClient(testDb.db, server, "acme");
    const response = await redeem(server, approved.clientId, approved.code, approved.verifier, { dpop: "not.a.proof" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_dpop_proof" });
  });
});

describe("the access token at /mcp", () => {
  it("full flow: token reaches /mcp and whoami names the agent and workspace", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    const me = await whoami(connected.accessToken);
    expect(me.agent).toEqual({ id: connected.agentId, name: "Laptop" });
    expect(me.workspace.id).toBe(connected.tenant.id);
  });

  it("names the agent and lasts an hour, with no tenant in its claims", async () => {
    const { accessToken, agentId, tenant } = await connectOAuthAgent(testDb.db, server, "acme");
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({ iss: OAUTH_ISSUER, aud: OAUTH_RESOURCE, agent_id: agentId });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(3600);
    expect(JSON.stringify(claims)).not.toContain(tenant.id);
  });

  it("a token for another audience is refused with 401", async () => {
    const { accessToken } = await connectOAuthAgent(testDb.db, server, "acme");
    const verify = (issuer: string, audience: string) => createOAuthVerifier(server.auth, { issuer, audience })(accessToken);
    await expect(verify(OAUTH_ISSUER, OAUTH_RESOURCE)).resolves.toMatchObject({ agentId: expect.any(String) });
    await expect(verify(OAUTH_ISSUER, `${OAUTH_BASE}/other`)).resolves.toBeNull();
    await expect(verify(`${OAUTH_BASE}/elsewhere`, OAUTH_RESOURCE)).resolves.toBeNull();

    // A real token from another deployment, on the same database and signing keys.
    const foreign = await connectOAuthAgent(testDb.db, createOAuthServer(testDb.db, "http://localhost:3300"), "foreign");
    server = createOAuthServer(testDb.db);
    expect((await initialize(foreign.accessToken)).status).toBe(401);
  });

  it("a token in the query string is ignored", async () => {
    const { accessToken } = await connectOAuthAgent(testDb.db, server, "acme");
    expect((await initialize(undefined, `${OAUTH_RESOURCE}?access_token=${accessToken}&token=${accessToken}`)).status).toBe(401);
  });

  it("garbage in the bearer is refused with 401", async () => {
    expect((await initialize("not-a-jwt")).status).toBe(401);
    expect((await initialize("a.b.c")).status).toBe(401);
  });

  it("an expired access token verifies as nothing, without throwing", async () => {
    const { accessToken } = await connectOAuthAgent(testDb.db, server, "acme");
    const verify = createOAuthVerifier(server.auth, { issuer: OAUTH_ISSUER, audience: OAUTH_RESOURCE });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
      await expect(verify(accessToken)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failure reading the signing keys is thrown, not taken for a bad token", async () => {
    const { accessToken } = await connectOAuthAgent(testDb.db, server, "acme");
    const broken = { api: { ...server.auth.api, getJwks: () => Promise.reject(new Error("database unavailable")) } } as unknown as typeof server.auth;
    const verify = createOAuthVerifier(broken, { issuer: OAUTH_ISSUER, audience: OAUTH_RESOURCE });
    await expect(verify(accessToken)).rejects.toThrow("database unavailable");
    // Garbage never reaches the keys, so it is still just refused.
    await expect(verify("a.b.c")).resolves.toBeNull();
    await expect(verify("not-a-jwt")).resolves.toBeNull();
  });

  it("a phn_ key still works", async () => {
    const ws = await seedWorkspace(testDb.db);
    const me = await whoami(ws.scout.token);
    expect(me.agent.id).toBe(ws.scout.agentId);
    expect(me.workspace.id).toBe(ws.tenant.id);
  });

  it("a verified token naming a key's agent is refused", async () => {
    const ws = await seedWorkspace(testDb.db);
    const { db } = testDb;
    server = { ...server, handler: createPheanMcpHandler({ getDb: () => db, verifyOAuthToken: () => Promise.resolve({ agentId: ws.scout.agentId, issuedAt: Math.floor(Date.now() / 1000) }) }) };
    expect((await initialize("a-verified-token")).status).toBe(401);
    expect((await initialize(ws.scout.token)).status).toBe(200);
  });

  it("an access token stops working immediately on revoke", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    expect((await initialize(connected.accessToken)).status).toBe(200);
    await revokeAgent(connected.ctx, { agentId: connected.agentId });
    expect((await initialize(connected.accessToken)).status).toBe(401);
  });

  it("renewing from another client cuts off the old client's access token, and the new one works", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    expect((await initialize(connected.accessToken)).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2000 });
    try {
      const clientId = await registerClientId(server);
      const { verifier, challenge } = pkce();
      const oauthQuery = await authorize(server, connected.cookie, clientId, challenge);
      const { agent, renewed } = await approveAgent(connected.ctx, { name: "Laptop", level: "read", lifetimeDays: 30, oauthClientId: clientId });
      expect({ id: agent.id, renewed }).toEqual({ id: connected.agentId, renewed: true });
      const { url } = await completeConsent(server.auth, new Headers({ cookie: connected.cookie }), { agentId: agent.id, oauthQuery });
      const tokens = (await (await redeem(server, clientId, new URL(url).searchParams.get("code")!, verifier)).json()) as { access_token: string };

      expect((await initialize(connected.accessToken)).status).toBe(401);
      expect((await whoami(tokens.access_token)).agent.id).toBe(connected.agentId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a named sub-agent on an OAuth token works the way it does on a key", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    const worker = await whoami(connected.accessToken, { agentName: "Worker" });
    expect(worker.agent.name).toBe("Worker");
    expect(worker.agent.id).not.toBe(connected.agentId);
    expect(worker.workspace.id).toBe(connected.tenant.id);
    const [row] = await testDb.db.select().from(agents).where(eq(agents.id, worker.agent.id));
    expect(row).toMatchObject({ parentAgentId: connected.agentId, sharesParentKey: true, tokenPrefix: null, accessLevel: "write" });

    await revokeAgent(connected.ctx, { agentId: connected.agentId });
    expect((await initialize(connected.accessToken, OAUTH_RESOURCE, { "phean-agent-name": "Worker" })).status).toBe(401);
    await expect(resolveOAuthAgent(testDb.db, connected.agentId)).resolves.toBeNull();
  });
});

describe("refreshing", () => {
  it("rotates the refresh token, and the new access token works", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    const response = await refresh(server, connected.clientId, connected.refreshToken);
    expect(response.status).toBe(200);
    const tokens = (await response.json()) as { access_token: string; refresh_token: string };
    expect(tokens.refresh_token).not.toBe(connected.refreshToken);
    expect((await whoami(tokens.access_token)).agent.id).toBe(connected.agentId);
  });

  it("a retried refresh inside the reuse window gets the same answer, and doesn't end the family", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    const first = (await (await refresh(server, connected.clientId, connected.refreshToken)).json()) as { refresh_token: string };
    const retried = await refresh(server, connected.clientId, connected.refreshToken);
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as { refresh_token: string }).refresh_token).toBe(first.refresh_token);
    expect((await refresh(server, connected.clientId, first.refresh_token)).status).toBe(200);
  });

  it("stops when the agent is revoked", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    await revokeAgent(connected.ctx, { agentId: connected.agentId });
    const response = await refresh(server, connected.clientId, connected.refreshToken);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
    expect(await refreshRows(connected.agentId)).toEqual([]);
  });

  it("a replay inside the reuse window after a revoke still gets nothing that works", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    await refresh(server, connected.clientId, connected.refreshToken);
    await revokeAgent(connected.ctx, { agentId: connected.agentId });
    expect((await refresh(server, connected.clientId, connected.refreshToken)).status).toBe(400);
  });

  it("stops when the agent expires, and a renewal replaces the old token", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    await testDb.db.update(agents).set({ accessExpiresAt: new Date(Date.now() - 1000) }).where(eq(agents.id, connected.agentId));
    const response = await refresh(server, connected.clientId, connected.refreshToken);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
    expect((await initialize(connected.accessToken)).status).toBe(401);

    // A refused refresh burns nothing, so it's the renewal that drops the old token.
    expect(await refreshRows(connected.agentId)).toHaveLength(1);
    await approveAgent(connected.ctx, { name: "Laptop", level: "write", lifetimeDays: 30, oauthClientId: connected.clientId });
    expect(await refreshRows(connected.agentId)).toEqual([]);
    expect((await refresh(server, connected.clientId, connected.refreshToken)).status).toBe(400);
  });

  it("stops when the approver leaves the workspace", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    await testDb.db.delete(member).where(eq(member.organizationId, connected.tenant.id));
    expect((await refresh(server, connected.clientId, connected.refreshToken)).status).toBe(400);
    expect((await initialize(connected.accessToken)).status).toBe(401);
  });

  it("revoking one agent leaves another agent's refresh token alone", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    const other = await connectOAuthAgent(testDb.db, server, "globex", "Desktop");
    await revokeAgent(connected.ctx, { agentId: connected.agentId });
    expect((await refresh(server, other.clientId, other.refreshToken)).status).toBe(200);
  });
});

describe("a workspace's own URL", () => {
  const workspaceUrl = (slug: string) => `${OAUTH_BASE}/mcp/w/${slug}`;

  /** The whole flow with the client pointed at the workspace's URL, as Cursor and VS Code need. */
  async function connectAtWorkspaceUrl(signedIn: SignedIn, slug = signedIn.tenant.slug) {
    const clientId = await registerClientId(server);
    const { verifier, challenge } = pkce();
    const response = await server.auth.handler(authorizeRequest(server, signedIn.cookie, clientId, challenge, { resource: workspaceUrl(slug) }));
    const location = new URL(response.headers.get("location") ?? "", OAUTH_BASE);
    if (location.pathname !== "/oauth/approve") return { clientId, location, tokens: null };
    const { agent } = await approveAgent(signedIn.ctx, { name: "Cursor", level: "write", lifetimeDays: 30, oauthClientId: clientId });
    const { url } = await completeConsent(server.auth, new Headers({ cookie: signedIn.cookie }), { agentId: agent.id, oauthQuery: location.search.slice(1) });
    const code = new URL(url).searchParams.get("code")!;
    const redeemed = await server.auth.handler(
      new Request(`${OAUTH_BASE}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: REDIRECT_URI, code_verifier: verifier, resource: workspaceUrl(slug) }),
      }),
    );
    const body = (await redeemed.json()) as { access_token: string; refresh_token: string; error?: string };
    const tokens = redeemed.ok ? body : null;
    return { clientId, location, agentId: agent.id, status: redeemed.status, error: body.error, tokens };
  }

  it("publishes its own resource metadata, and none for a workspace that doesn't exist", async () => {
    const { tenant } = await signUpOwner(testDb.db, server, "acme");
    const response = await workspaceResourceMetadata(server.auth, () => testDb.db)(new Request(`${OAUTH_BASE}/.well-known/oauth-protected-resource/mcp/w/${tenant.slug}`), tenant.slug);
    expect(response.status).toBe(200);
    // VS Code requires this to equal the URL it was given, exactly.
    expect(await response.json()).toMatchObject({ resource: workspaceUrl(tenant.slug), authorization_servers: [OAUTH_ISSUER] });
    expect((await workspaceResourceMetadata(server.auth, () => testDb.db)(new Request(`${OAUTH_BASE}/x`), "no-such-workspace")).status).toBe(404);
  });

  it("challenges with its own metadata address", async () => {
    const response = await initialize(undefined, workspaceUrl("acme"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${OAUTH_BASE}/.well-known/oauth-protected-resource/mcp/w/acme"`);
  });

  it("the dialog learns the workspace from the signed request", async () => {
    const signedIn = await signUpOwner(testDb.db, server, "acme");
    const { location } = await connectAtWorkspaceUrl(signedIn);
    expect(await readConsentRequest(server.auth, location.search.slice(1))).toMatchObject({ status: "ok", workspace: signedIn.tenant.slug });
  });

  it("full flow: the token is for that URL only, and whoami names that workspace", async () => {
    const signedIn = await signUpOwner(testDb.db, server, "acme");
    const { tokens, agentId } = await connectAtWorkspaceUrl(signedIn);
    expect(tokens).not.toBeNull();
    const claims = JSON.parse(Buffer.from(tokens!.access_token.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    expect(claims.aud).toBe(workspaceUrl(signedIn.tenant.slug));
    const client = await connectMcpClient(server.handler, tokens!.access_token, { url: workspaceUrl(signedIn.tenant.slug) });
    try {
      const me = dataOf<{ agent: { id: string }; workspace: { id: string } }>(await client.callTool({ name: "whoami", arguments: {} }));
      expect(me).toMatchObject({ agent: { id: agentId }, workspace: { id: signedIn.tenant.id } });
    } finally {
      await client.close();
    }
    // Bound to its own URL: not the shared one, not another workspace's.
    expect((await initialize(tokens!.access_token)).status).toBe(401);
    expect((await initialize(tokens!.access_token, workspaceUrl("someone-else"))).status).toBe(401);
  });

  it("refreshes for the same URL", async () => {
    const signedIn = await signUpOwner(testDb.db, server, "acme");
    const { tokens, clientId } = await connectAtWorkspaceUrl(signedIn);
    const response = await refresh(server, clientId, tokens!.refresh_token);
    expect(response.status).toBe(200);
    const { access_token } = (await response.json()) as { access_token: string };
    expect((await initialize(access_token, workspaceUrl(signedIn.tenant.slug))).status).toBe(200);
  });

  it("a shared-URL token is refused there", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    expect((await initialize(connected.accessToken, workspaceUrl(connected.tenant.slug))).status).toBe(401);
  });

  it("a token for another workspace is refused there", async () => {
    const acme = await signUpOwner(testDb.db, server, "acme");
    const globex = await connectOAuthAgent(testDb.db, server, "globex");
    // Even a token the verifier accepts for acme's URL is refused when its agent works in globex.
    const { db } = testDb;
    server = { ...server, handler: createPheanMcpHandler({ getDb: () => db, verifyOAuthToken: () => Promise.resolve({ agentId: globex.agentId, issuedAt: Math.floor(Date.now() / 1000) }) }) };
    expect((await initialize("a-verified-token", workspaceUrl(acme.tenant.slug))).status).toBe(401);
    expect((await initialize("a-verified-token", workspaceUrl(globex.tenant.slug))).status).toBe(200);
  });

  it("a key works at its own workspace's URL and nowhere else", async () => {
    const ws = await seedWorkspace(testDb.db);
    const other = await seedWorkspace(testDb.db);
    expect((await initialize(ws.scout.token, workspaceUrl(ws.tenant.slug))).status).toBe(200);
    expect((await initialize(ws.scout.token, workspaceUrl(other.tenant.slug))).status).toBe(401);
  });

  it("a code approved for another workspace than the URL's is never exchanged", async () => {
    const acme = await signUpOwner(testDb.db, server, "acme");
    const globex = await signUpOwner(testDb.db, server, "globex");
    // Globex's owner, holding a signed request for acme's URL, approves an agent in globex.
    const { tokens, status, error } = await connectAtWorkspaceUrl(globex, acme.tenant.slug);
    expect(tokens).toBeNull();
    expect(status).toBe(400);
    expect(error).toBe("invalid_grant");
  });

  it("authorize refuses the URL of a workspace that doesn't exist", async () => {
    const { cookie } = await signUpOwner(testDb.db, server, "acme");
    const clientId = await registerClientId(server);
    const response = await server.auth.handler(authorizeRequest(server, cookie, clientId, pkce().challenge, { resource: workspaceUrl("no-such-workspace") }));
    expect(response.headers.get("location")).toContain("invalid_target");
  });
});
