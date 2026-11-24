import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appendSignal, parseSignals, SIGNAL_COOKIE } from "@/lib/analytics-signals";
import { setAnalyticsSender } from "@/server/analytics";
import { createAuth, type Auth } from "@/server/auth/auth";

import { createTestDb, type TestDb } from "./support/db";
import { jsonPost, OAUTH_BASE } from "./support/oauth";

const BASE = OAUTH_BASE;
const PASSWORD = "correct-horse-battery";

/** A browser's cookies across requests: each response's Set-Cookie replaces or expires what it names. */
class Jar {
  cookies = new Map<string, string>();

  take(response: Response): Response {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const [name = "", ...value] = pair.split("=");
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired || value.join("=") === "") this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value.join("="));
    }
    return response;
  }

  get header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function browser(auth: Auth, jar = new Jar()) {
  return {
    jar,
    post: async (path: string, body: unknown) => jar.take(await auth.handler(jsonPost(`${BASE}/api/auth${path}`, body, { cookie: jar.header, origin: BASE }))),
    get: async (path: string) => jar.take(await auth.handler(new Request(`${BASE}/api/auth${path}`, { headers: { cookie: jar.header, origin: BASE }, redirect: "manual" }))),
  };
}
type Browser = ReturnType<typeof browser>;

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

async function throughGitHub(client: Browser, start: "/sign-in/social" | "/link-social"): Promise<Response> {
  const started = await client.post(start, { provider: "github", callbackURL: "/workspaces", disableRedirect: true });
  const { url } = (await started.json()) as { url: string };
  return client.get(`/callback/github?code=test-code&state=${new URL(url).searchParams.get("state")}`);
}

let testDb: TestDb;
let auth: Auth;
let sent: { user_id?: string; events: { name: string; params: Record<string, unknown> }[] }[];

/** Lets the after-commit hooks and the capture's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const names = () => sent.flatMap((body) => body.events.map((event) => event.name));

beforeEach(async () => {
  testDb = await createTestDb();
  vi.stubEnv("BETTER_AUTH_URL", BASE);
  vi.stubEnv("BETTER_AUTH_SECRET", "phean-analytics-tests-only-secret-0123456789");
  vi.stubEnv("GITHUB_CLIENT_ID", "test-github-client");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "test-github-secret");
  vi.stubEnv("ANALYTICS_ID_SALT", "analytics-test-salt");
  sent = [];
  setAnalyticsSender(async (body) => {
    sent.push(body as (typeof sent)[number]);
  });
  auth = createAuth(testDb.db, BASE);
});

afterEach(async () => {
  setAnalyticsSender(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await testDb.close();
});

describe("sign_up from the server", () => {
  it("sends one for a password sign-up, with the hashed person and no email", async () => {
    const client = browser(auth);
    expect((await client.post("/sign-up/email", { name: "Dana", email: "dana@example.com", password: PASSWORD })).status).toBe(200);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.events[0]).toMatchObject({ name: "sign_up", params: { method: "password", source_side: "server" } });
    expect(sent[0]!.user_id).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(sent)).not.toContain("dana");
  });

  it("sends one for a GitHub sign-up, and nothing when GitHub is connected to an existing account", async () => {
    fakeGitHub({ id: 77, email: "sam@users.github.example" });
    await throughGitHub(browser(auth), "/sign-in/social");
    await settle();
    expect(sent.map((body) => body.events[0])).toEqual([expect.objectContaining({ name: "sign_up", params: expect.objectContaining({ method: "github" }) })]);

    sent = [];
    vi.restoreAllMocks();
    fakeGitHub({ id: 78, email: "dana@users.github.example" });
    const client = browser(auth);
    await client.post("/sign-up/email", { name: "Dana", email: "dana@example.com", password: PASSWORD });
    await settle();
    sent = [];
    await throughGitHub(client, "/link-social");
    await settle();
    expect(names()).toEqual([]);
  });
});

describe("workspace_create from the server", () => {
  it("sends one with the hashed workspace when a workspace is created", async () => {
    const client = browser(auth);
    await client.post("/sign-up/email", { name: "Dana", email: "dana@example.com", password: PASSWORD });
    await settle();
    sent = [];
    await auth.api.createOrganization({ body: { name: "Acme", slug: "acme" }, headers: new Headers({ cookie: client.jar.header }) });
    await settle();
    expect(names()).toEqual(["workspace_create"]);
    expect(sent[0]!.events[0]!.params.workspace_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(sent)).not.toContain("acme");
  });
});

describe("the signal cookie after a provider's callback", () => {
  it("tells the next page about a GitHub sign-up, then a sign-in, only with consent", async () => {
    fakeGitHub({ id: 91, email: "kim@users.github.example" });
    const consenting = browser(auth);
    consenting.jar.cookies.set("phean-consent", "granted");
    await throughGitHub(consenting, "/sign-in/social");
    expect(parseSignals(consenting.jar.cookies.get(SIGNAL_COOKIE))).toEqual([{ event: "sign_up", method: "github" }]);

    // An hour later the same person signs in again elsewhere.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60 * 60 * 1000 });
    try {
      const again = browser(auth);
      again.jar.cookies.set("phean-consent", "granted");
      await throughGitHub(again, "/sign-in/social");
      expect(parseSignals(again.jar.cookies.get(SIGNAL_COOKIE))).toEqual([{ event: "login", method: "github" }]);

      const declined = browser(auth);
      declined.jar.cookies.set("phean-consent", "denied");
      await throughGitHub(declined, "/sign-in/social");
      expect(declined.jar.cookies.has(SIGNAL_COOKIE)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("signal values", () => {
  it("keep only catalog enums and the latest few", () => {
    let value = "";
    for (const role of ["member", "admin", "owner", "member", "admin"] as const) value = appendSignal(value, { event: "invite_accept", role });
    expect(parseSignals(value)).toHaveLength(4);
    expect(parseSignals("sign_up.github~login.dana@example.com~workspace_create~invite_accept.root")).toEqual([{ event: "sign_up", method: "github" }, { event: "workspace_create" }]);
    expect(parseSignals("%E0")).toEqual([]);
  });
});
