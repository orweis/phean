import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { totpCode } from "../e2e/support/totp";
import { createAuth, type Auth } from "@/server/auth/auth";

import { createTestDb, type TestDb } from "./support/db";
import { jsonPost, OAUTH_BASE } from "./support/oauth";

const BASE = OAUTH_BASE;
const PASSWORD = "correct-horse-battery";

/** A browser's cookies across requests: each response's Set-Cookie replaces or expires what it names. */
class Jar {
  private cookies = new Map<string, string>();

  take(response: Response): Response {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const [name = "", ...value] = pair.split("=");
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute) || /^\s*expires=thu, 01 jan 1970/i.test(attribute));
      if (expired || value.join("=") === "") this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value.join("="));
    }
    return response;
  }

  has(fragment: string): boolean {
    return [...this.cookies.keys()].some((name) => name.includes(fragment));
  }

  get header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

interface Browser {
  jar: Jar;
  post: (path: string, body: unknown) => Promise<Response>;
  get: (path: string) => Promise<Response>;
}

function browser(auth: Auth, jar = new Jar()): Browser {
  return {
    jar,
    post: async (path, body) => jar.take(await auth.handler(jsonPost(`${BASE}/api/auth${path}`, body, { cookie: jar.header, origin: BASE }))),
    get: async (path) => jar.take(await auth.handler(new Request(`${BASE}/api/auth${path}`, { headers: { cookie: jar.header, origin: BASE }, redirect: "manual" }))),
  };
}

async function signedInAs(client: Browser): Promise<string | null> {
  const response = await client.get("/get-session");
  const body = (await response.json()) as { user?: { email: string } } | null;
  return body?.user?.email ?? null;
}

/** Signs a new person up with a password and turns two-factor on through the real endpoints. */
async function withTwoFactor(auth: Auth, email: string): Promise<{ uri: string; backupCodes: string[] }> {
  const client = browser(auth);
  expect((await client.post("/sign-up/email", { name: "Dana", email, password: PASSWORD })).status).toBe(200);
  const enabled = await client.post("/two-factor/enable", { password: PASSWORD });
  const { totpURI: uri, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
  expect(uri).toMatch(/^otpauth:\/\/totp\/Phean:/);
  expect((await client.post("/two-factor/verify-totp", { code: totpCode(uri) })).status).toBe(200);
  return { uri, backupCodes };
}

let testDb: TestDb;
let auth: Auth;

beforeEach(async () => {
  testDb = await createTestDb();
  vi.stubEnv("BETTER_AUTH_URL", BASE);
  vi.stubEnv("BETTER_AUTH_SECRET", "phean-account-tests-only-secret-0123456789");
  vi.stubEnv("GITHUB_CLIENT_ID", "test-github-client");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "test-github-secret");
  auth = createAuth(testDb.db, BASE);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await testDb.close();
});

describe("two-factor after a password", () => {
  it("asks for the code, refuses a wrong one, and signs in with the right one", async () => {
    const { uri } = await withTwoFactor(auth, "dana@example.com");
    const client = browser(auth);

    const signIn = await client.post("/sign-in/email", { email: "dana@example.com", password: PASSWORD });
    expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(await signedInAs(client)).toBeNull();

    const wrong = await client.post("/two-factor/verify-totp", { code: totpCode(uri, { stepOffset: 5 }) });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ code: "INVALID_CODE" });
    expect(await signedInAs(client)).toBeNull();

    expect((await client.post("/two-factor/verify-totp", { code: totpCode(uri) })).status).toBe(200);
    expect(await signedInAs(client)).toBe("dana@example.com");
  });

  it("skips the code on a browser the person chose to trust", async () => {
    const { uri } = await withTwoFactor(auth, "dana@example.com");
    const client = browser(auth);
    await client.post("/sign-in/email", { email: "dana@example.com", password: PASSWORD });
    await client.post("/two-factor/verify-totp", { code: totpCode(uri), trustDevice: true });
    await client.post("/sign-out", {});

    const again = await client.post("/sign-in/email", { email: "dana@example.com", password: PASSWORD });
    expect(await again.json()).not.toHaveProperty("twoFactorRedirect");
    expect(await signedInAs(client)).toBe("dana@example.com");
  });

  it("takes each backup code once", async () => {
    const { backupCodes } = await withTwoFactor(auth, "dana@example.com");
    const [code] = backupCodes;
    const first = browser(auth);
    await first.post("/sign-in/email", { email: "dana@example.com", password: PASSWORD });
    expect((await first.post("/two-factor/verify-backup-code", { code })).status).toBe(200);
    expect(await signedInAs(first)).toBe("dana@example.com");

    const second = browser(auth);
    await second.post("/sign-in/email", { email: "dana@example.com", password: PASSWORD });
    expect((await second.post("/two-factor/verify-backup-code", { code })).status).toBe(401);
    expect(await signedInAs(second)).toBeNull();
  });

  it("needs the password to turn it off", async () => {
    const { uri } = await withTwoFactor(auth, "dana@example.com");
    const client = browser(auth);
    await client.post("/sign-in/email", { email: "dana@example.com", password: PASSWORD });
    await client.post("/two-factor/verify-totp", { code: totpCode(uri) });
    expect((await client.post("/two-factor/disable", { password: "not-my-password" })).status).toBe(400);
    expect((await client.post("/two-factor/disable", { password: PASSWORD })).status).toBe(200);
    await client.post("/sign-out", {});
    expect(await (await client.post("/sign-in/email", { email: "dana@example.com", password: PASSWORD })).json()).not.toHaveProperty("twoFactorRedirect");
  });
});

/** GitHub's token and profile endpoints, answered in-process for one GitHub account. */
function fakeGitHub(account: { id: number; email: string }) {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "gho_test", token_type: "bearer", scope: "read:user,user:email" });
    if (url === "https://api.github.com/user") return Response.json({ id: account.id, login: "dana", name: "Dana", email: account.email, avatar_url: "" });
    if (url === "https://api.github.com/user/emails") return Response.json([{ email: account.email, primary: true, verified: true }]);
    return real(input, init);
  });
}

/** Starts a GitHub sign-in or link and comes back through the callback, as the browser would. */
async function throughGitHub(client: Browser, start: "/sign-in/social" | "/link-social", callbackURL: string): Promise<Response> {
  const started = await client.post(start, { provider: "github", callbackURL, disableRedirect: true });
  expect(started.status).toBe(200);
  const { url } = (await started.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  return client.get(`/callback/github?code=test-code&state=${state}`);
}

describe("connecting sign-in methods", () => {
  it("connects GitHub to a password account, even under another address, and signs in with it", async () => {
    fakeGitHub({ id: 4242, email: "dana@users.github.example" });
    const client = browser(auth);
    await client.post("/sign-up/email", { name: "Dana", email: "dana@example.com", password: PASSWORD });

    const linked = await throughGitHub(client, "/link-social", "/account?connected=github");
    expect(linked.headers.get("location")).toBe("/account?connected=github");
    const accounts = (await (await client.get("/list-accounts")).json()) as { providerId: string }[];
    expect(accounts.map((account) => account.providerId).sort()).toEqual(["credential", "github"]);

    const elsewhere = browser(auth);
    const signedIn = await throughGitHub(elsewhere, "/sign-in/social", "/workspaces");
    expect(signedIn.headers.get("location")).toBe("/workspaces");
    expect(await signedInAs(elsewhere)).toBe("dana@example.com");
  });

  it("keeps the last way in", async () => {
    const client = browser(auth);
    await client.post("/sign-up/email", { name: "Dana", email: "dana@example.com", password: PASSWORD });
    const [password] = (await (await client.get("/list-accounts")).json()) as { id: string }[];
    const refused = await client.post("/unlink-account", { accountId: password!.id });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "FAILED_TO_UNLINK_LAST_ACCOUNT" });
  });

  it("lets a GitHub-only person add a password, then remove GitHub", async () => {
    fakeGitHub({ id: 77, email: "sam@example.com" });
    const client = browser(auth);
    await throughGitHub(client, "/sign-in/social", "/workspaces");
    expect(await signedInAs(client)).toBe("sam@example.com");

    await auth.api.setPassword({ body: { newPassword: PASSWORD }, headers: new Headers({ cookie: client.jar.header }) });
    const accounts = (await (await client.get("/list-accounts")).json()) as { id: string; providerId: string }[];
    const github = accounts.find((account) => account.providerId === "github")!;
    expect((await client.post("/unlink-account", { accountId: github.id })).status).toBe(200);

    const withPassword = browser(auth);
    expect((await withPassword.post("/sign-in/email", { email: "sam@example.com", password: PASSWORD })).status).toBe(200);
    expect(await signedInAs(withPassword)).toBe("sam@example.com");
  });
});

describe("two-factor after GitHub", () => {
  it("asks for the code after a GitHub sign-in, then lands where the person was headed", async () => {
    const { uri } = await withTwoFactor(auth, "dana@example.com");
    fakeGitHub({ id: 4242, email: "dana@example.com" });
    const owner = browser(auth);
    await owner.post("/sign-in/email", { email: "dana@example.com", password: PASSWORD });
    await owner.post("/two-factor/verify-totp", { code: totpCode(uri) });
    await throughGitHub(owner, "/link-social", "/account");

    const client = browser(auth);
    const callback = await throughGitHub(client, "/sign-in/social", "/w/acme/decisions");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${BASE}/sign-in/two-factor?next=%2Fw%2Facme%2Fdecisions`);
    expect(client.jar.has("two_factor")).toBe(true);
    expect(await signedInAs(client)).toBeNull();

    expect((await client.post("/two-factor/verify-totp", { code: totpCode(uri, { stepOffset: 7 }) })).status).toBe(401);
    expect(await signedInAs(client)).toBeNull();
    expect((await client.post("/two-factor/verify-totp", { code: totpCode(uri), trustDevice: true })).status).toBe(200);
    expect(await signedInAs(client)).toBe("dana@example.com");

    // The browser it was told to trust goes straight through next time.
    await client.post("/sign-out", {});
    const trusted = await throughGitHub(client, "/sign-in/social", "/workspaces");
    expect(trusted.headers.get("location")).toBe("/workspaces");
    expect(await signedInAs(client)).toBe("dana@example.com");
  });

  it("lets a GitHub sign-in through untouched when two-factor is off", async () => {
    fakeGitHub({ id: 9, email: "lee@example.com" });
    const client = browser(auth);
    const callback = await throughGitHub(client, "/sign-in/social", "/workspaces");
    expect(callback.headers.get("location")).toBe("/workspaces");
    expect(await signedInAs(client)).toBe("lee@example.com");
  });
});
