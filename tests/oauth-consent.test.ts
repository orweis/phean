import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { grantableLevels, LIMITS, lifetimeLabel } from "@/lib/domain";
import { authorizeRetryPath, clientDisplayName, consentScope, redirectTarget, renewalKey } from "@/lib/oauth-consent";
import { safeNextPath } from "@/lib/routes";
import { completeConsent } from "@/server/auth/auth";
import { readConsentRequest } from "@/server/auth/consent";
import { approveAgent } from "@/server/domain/agents";

import nextConfig from "../next.config";
import { createTestDb, type TestDb } from "./support/db";
import { authorize, authorizeRequest, createOAuthServer, OAUTH_RESOURCE, pkce, redeem, REDIRECT_URI, registerClientId, signUpOwner, type OAuthServer } from "./support/oauth";

describe("grantableLevels", () => {
  it("gives Admin only to owners and admins", () => {
    expect(grantableLevels("owner")).toContain("admin");
    expect(grantableLevels("admin")).toContain("admin");
    expect(grantableLevels("member")).toEqual(["read", "write"]);
  });

  it("gives any other role read and write, so a new role starts without Admin", () => {
    for (const role of ["platform_admin", "billing", "", "OWNER"]) expect(grantableLevels(role)).toEqual(["read", "write"]);
  });
});

describe("lifetimeLabel", () => {
  it("names each lifetime", () => {
    expect([1, 7, 365].map(lifetimeLabel)).toEqual(["1 day", "7 days", "1 year"]);
  });
});

describe("authorizeRetryPath", () => {
  const retry = (query: string) => new URLSearchParams(authorizeRetryPath(query).split("?")[1]);

  it("goes to authorize without what the signature added", () => {
    const path = authorizeRetryPath("client_id=c1&scope=phean%3Aread+offline_access&sig=s&exp=1&ba_iat=2&ba_pl=3&ba_param=4");
    expect(path.startsWith("/api/auth/oauth2/authorize?")).toBe(true);
    expect(safeNextPath(path)).toBe(path);
    expect([...new URLSearchParams(path.split("?")[1]).keys()]).toEqual(["client_id", "scope"]);
    expect(new URLSearchParams(path.split("?")[1]).get("scope")).toBe("phean:read offline_access");
  });

  it("keeps every resource", () => {
    expect(retry("resource=a&resource=b").getAll("resource")).toEqual(["a", "b"]);
  });

  it("drops what would send a signed-in person back to sign-in forever", () => {
    expect(retry("client_id=c&prompt=login").has("prompt")).toBe(false);
    expect(retry("client_id=c&prompt=create").has("prompt")).toBe(false);
    expect(retry("client_id=c&prompt=select_account").has("prompt")).toBe(false);
    expect(retry("client_id=c&prompt=login+consent").get("prompt")).toBe("consent");
    expect(retry("client_id=c&max_age=0").has("max_age")).toBe(false);
  });
});

describe("redirectTarget", () => {
  it("shows the real host of a web address, never its user info", () => {
    expect(redirectTarget("https://good.example@evil.example/cb")).toEqual({ label: "evil.example", loopback: false });
  });

  it("marks only loopback addresses as local", () => {
    for (const uri of ["http://localhost:1234/cb", "http://127.0.0.1:43123/cb", "http://127.8.0.1/cb", "http://[::1]:9/cb", "http://app.localhost/cb"]) {
      expect(redirectTarget(uri)?.loopback, uri).toBe(true);
    }
    for (const uri of ["https://localhost.evil.example/cb", "https://127.0.0.1.evil.example/cb", "cursor://localhost/cb"]) {
      expect(redirectTarget(uri)?.loopback, uri).toBe(false);
    }
  });

  it("names the scheme of an app's address", () => {
    expect(redirectTarget("cursor://anysphere.cursor-retrieval/oauth/callback")).toEqual({ label: "cursor://anysphere.cursor-retrieval", loopback: false });
    expect(redirectTarget("com.example.app:/callback")).toEqual({ label: "com.example.app:", loopback: false });
  });

  it("refuses what is not an address a browser may be sent to", () => {
    for (const uri of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "blob:x", "about:blank", "not a url", ""]) {
      expect(redirectTarget(uri), uri).toBeNull();
    }
  });
});

describe("clientDisplayName", () => {
  it("cuts a long name to the limit", () => {
    expect(clientDisplayName("A".repeat(LIMITS.name * 3))).toHaveLength(LIMITS.name);
  });

  it("does not leave half an emoji at the cut", () => {
    const name = clientDisplayName(`${"A".repeat(LIMITS.name - 1)}😀`);
    expect(name).toBe("A".repeat(LIMITS.name - 1));
  });

  it("removes control and direction characters that disguise a name", () => {
    expect(clientDisplayName("  Claude‮edoc\n​ ")).toBe("Claudeedoc");
  });

  it("is empty for a client with no name", () => {
    expect(clientDisplayName(undefined)).toBe("");
    expect(clientDisplayName(" ​ ")).toBe("");
  });
});

describe("consentScope", () => {
  const all = "phean:read phean:write phean:admin offline_access";

  it("keeps the requested scopes at or below the chosen level, and offline_access", () => {
    expect(consentScope(all, "read")).toBe("phean:read offline_access");
    expect(consentScope(all, "write")).toBe("phean:read phean:write offline_access");
    expect(consentScope(all, "admin")).toBe(all);
  });

  it("never adds what the client did not ask for", () => {
    expect(consentScope("phean:read", "admin")).toBe("phean:read");
    expect(consentScope("phean:write", "write")).toBe("phean:write");
  });

  it("leaves the scope alone when nothing would remain, since consent refuses an empty one", () => {
    expect(consentScope("phean:admin", "read")).toBeUndefined();
    expect(consentScope(null, "read")).toBeUndefined();
    expect(consentScope("", "read")).toBeUndefined();
  });
});

describe("renewalKey", () => {
  it("ignores the spaces the name loses on saving, and tells workspaces apart", () => {
    expect(renewalKey("acme", " Laptop ")).toBe(renewalKey("acme", "Laptop"));
    expect(renewalKey("acme", "Laptop")).not.toBe(renewalKey("globex", "Laptop"));
  });

  it("comes back unchanged from a form post, which would turn a newline into CRLF", () => {
    expect(renewalKey("acme", "Laptop")).not.toMatch(/[\r\n]/);
  });
});

describe("framing", () => {
  it("refuses frames on every /oauth page, the two ways browsers read it", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find(({ source }) => source === "/oauth/:path*");
    const headers = Object.fromEntries(rule!.headers.map(({ key, value }) => [key.toLowerCase(), value]));
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  });
});

describe("the signed request behind the dialog", () => {
  let testDb: TestDb;
  let server: OAuthServer;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(() => {
    server = createOAuthServer(testDb.db);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  afterAll(() => testDb.close());

  async function signedQuery() {
    const signedIn = await signUpOwner(testDb.db, server, "consent");
    const clientId = await registerClientId(server);
    const { verifier, challenge } = pkce();
    return { ...signedIn, clientId, verifier, challenge, query: await authorize(server, signedIn.cookie, clientId, challenge) };
  }

  it("reads a valid request", async () => {
    const { clientId, query } = await signedQuery();
    expect(await readConsentRequest(server.auth, query)).toEqual({
      status: "ok",
      clientId,
      redirectUri: REDIRECT_URI,
      target: { label: "127.0.0.1", loopback: true },
      scope: "phean:read phean:write offline_access",
    });
  });

  it("refuses a tampered request", async () => {
    const { query } = await signedQuery();
    const tampered = new URLSearchParams(query);
    tampered.set("redirect_uri", "https://evil.example/cb");
    expect(await readConsentRequest(server.auth, tampered.toString())).toEqual({ status: "invalid" });
    expect(await readConsentRequest(server.auth, "")).toEqual({ status: "invalid" });
  });

  it("refuses a signed request for another resource, or none", async () => {
    const { query } = await signedQuery();
    // Signed for this deployment, read by one with another address.
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3999");
    expect(await readConsentRequest(server.auth, query)).toEqual({ status: "invalid" });
    vi.stubEnv("BETTER_AUTH_URL", server.baseUrl);

    const { cookie, clientId, challenge } = await signedQuery();
    const response = await server.auth.handler(authorizeRequest(server, cookie, clientId, challenge, { resource: "" }));
    const location = response.headers.get("location");
    const search = location ? new URL(location, server.baseUrl).search.slice(1) : "";
    expect(await readConsentRequest(server.auth, search)).toEqual({ status: "invalid" });
  });

  it("sends a request past its ten minutes back through authorize, which gives a fresh dialog", async () => {
    const { query, cookie, clientId, challenge } = await signedQuery();
    vi.useFakeTimers({ now: Date.now() + 11 * 60 * 1000, toFake: ["Date"] });

    const stale = await readConsentRequest(server.auth, query);
    expect(stale.status).toBe("stale");
    if (stale.status !== "stale") return;

    const retried = await server.auth.handler(new Request(`${server.baseUrl}${stale.retryPath}`, { headers: { cookie } }));
    const fresh = new URL(retried.headers.get("location")!, server.baseUrl);
    expect(fresh.pathname).toBe("/oauth/approve");
    expect(fresh.searchParams.get("client_id")).toBe(clientId);
    expect(fresh.searchParams.get("code_challenge")).toBe(challenge);
    expect((await readConsentRequest(server.auth, fresh.search.slice(1))).status).toBe("ok");
  });

  it("a token carries the narrowed scope for the chosen level, and the same audience", async () => {
    const { ctx, cookie, clientId, verifier, query } = await signedQuery();
    const { agent } = await approveAgent(ctx, { name: "Reader", level: "read", lifetimeDays: 1, oauthClientId: clientId });
    const scope = consentScope(new URLSearchParams(query).get("scope"), "read");
    const { url } = await completeConsent(server.auth, new Headers({ cookie }), { agentId: agent.id, oauthQuery: query, scope });

    const response = await redeem(server, clientId, new URL(url).searchParams.get("code")!, verifier);
    const tokens = (await response.json()) as { scope: string; access_token: string };
    expect(tokens.scope).toBe("phean:read offline_access");
    const claims = JSON.parse(Buffer.from(tokens.access_token.split(".")[1]!, "base64url").toString()) as { aud: string | string[] };
    expect(claims.aud).toContain(OAUTH_RESOURCE);
  });
});
