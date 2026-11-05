import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { completeConsent } from "@/server/auth/auth";
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
  refresh,
  registerClient,
  registerClientId,
  signUpOwner,
  type OAuthServer,
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
    const response = await oauthProviderAuthServerMetadata(server.auth)(new Request(`${OAUTH_BASE}/.well-known/oauth-authorization-server/api/auth`));
    expect(await response.json()).toMatchObject({
      issuer: OAUTH_ISSUER,
      code_challenge_methods_supported: ["S256"],
      registration_endpoint: `${OAUTH_ISSUER}/oauth2/register`,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
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

  it("DCR refuses a confidential client without credentials", async () => {
    const before = await testDb.db.select({ id: oauthClient.id }).from(oauthClient);
    for (const method of ["client_secret_basic", "client_secret_post", undefined]) {
      const response = await registerClient(server, { token_endpoint_auth_method: method });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_client_metadata" });
    }
    expect(await testDb.db.select({ id: oauthClient.id }).from(oauthClient)).toHaveLength(before.length);
  });

  it("holds the register route to the built-in limit unless raised", () => {
    const registerLimit = ({ auth }: OAuthServer) =>
      auth.options.plugins.flatMap((plugin) => ("rateLimit" in plugin ? (plugin.rateLimit ?? []) : [])).find((rule) => rule.pathMatcher("/oauth2/register"))?.max;
    expect(registerLimit(server)).toBe(5);
    vi.stubEnv("PHEAN_OAUTH_REGISTER_LIMIT", "500");
    expect(registerLimit(createOAuthServer(testDb.db))).toBe(500);
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

  it("a phn_ key still works", async () => {
    const ws = await seedWorkspace(testDb.db);
    const me = await whoami(ws.scout.token);
    expect(me.agent.id).toBe(ws.scout.agentId);
    expect(me.workspace.id).toBe(ws.tenant.id);
  });

  it("a verified token naming a key's agent is refused", async () => {
    const ws = await seedWorkspace(testDb.db);
    const { db } = testDb;
    server = { ...server, handler: createPheanMcpHandler({ getDb: () => db, verifyOAuthToken: () => Promise.resolve({ agentId: ws.scout.agentId }) }) };
    expect((await initialize("a-verified-token")).status).toBe(401);
    expect((await initialize(ws.scout.token)).status).toBe(200);
  });

  it("an access token stops working immediately on revoke", async () => {
    const connected = await connectOAuthAgent(testDb.db, server, "acme");
    expect((await initialize(connected.accessToken)).status).toBe(200);
    await revokeAgent(connected.ctx, { agentId: connected.agentId });
    expect((await initialize(connected.accessToken)).status).toBe(401);
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
