import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { totpCode } from "../e2e/support/totp";
import nextConfig from "../next.config";
import { routes } from "@/lib/routes";
import { createAuth, type Auth } from "@/server/auth/auth";
import { decideNativeRequest, findNativeRequest, isLoopbackCallback, NATIVE_CODE_SECONDS, NATIVE_EXCHANGE_LIMIT, NATIVE_START_LIMIT, nativeConfirmRoute } from "@/server/auth/native";
import { session as sessionTable } from "@/server/db/schema/auth";

import { createTestDb, type TestDb } from "./support/db";
import { OAUTH_BASE } from "./support/oauth";

const BASE = OAUTH_BASE;
const PASSWORD = "correct-horse-battery";
const CALLBACK = "http://127.0.0.1:43123/callback";
const DESKTOP = { "content-type": "application/json", "phean-client": "desktop" };

/** A browser's cookies: each response's Set-Cookie replaces or expires what it names. */
function cookiesOf(response: Response, jar = new Map<string, string>()): Map<string, string> {
  for (const line of response.headers.getSetCookie()) {
    const [pair = "", ...attributes] = line.split(";");
    const [name = "", ...value] = pair.split("=");
    const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    if (expired || value.join("=") === "") jar.delete(name.trim());
    else jar.set(name.trim(), value.join("="));
  }
  return jar;
}

const header = (jar: Map<string, string>) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

let testDb: TestDb;
let auth: Auth;
let confirm: (request: Request) => Promise<Response>;

beforeEach(async () => {
  testDb = await createTestDb();
  vi.stubEnv("BETTER_AUTH_URL", BASE);
  vi.stubEnv("BETTER_AUTH_SECRET", "phean-native-tests-only-secret-0123456789");
  auth = createAuth(testDb.db, BASE);
  confirm = nativeConfirmRoute(auth, BASE);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await testDb.close();
});

function post(path: string, body: unknown, headers: Record<string, string> = DESKTOP): Promise<Response> {
  return auth.handler(new Request(`${BASE}/api/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
}

/** A person with a password, signed in in a browser of their own. */
async function signedUp(email = `${randomBytes(6).toString("hex")}@example.com`): Promise<{ id: string; email: string; jar: Map<string, string> }> {
  const response = await post("/sign-up/email", { name: "Dana", email, password: PASSWORD }, { "content-type": "application/json", origin: BASE });
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as { user: { id: string } };
  return { id: user.id, email, jar: cookiesOf(response) };
}

async function start(overrides: Record<string, unknown> = {}, headers: Record<string, string> = DESKTOP) {
  const { verifier, challenge } = pkce();
  const response = await post("/native/start", { client: "desktop", codeChallenge: challenge, redirectUri: CALLBACK, state: "state-0123456789", ...overrides }, headers);
  return { response, verifier, challenge };
}

async function started() {
  const { response, verifier } = await start();
  expect(response.status).toBe(200);
  const body = (await response.json()) as { requestId: string; confirmation: string; expiresAt: string };
  return { ...body, verifier };
}

/** The browser's form post on /native/authorize. */
function confirmRequest(jar: Map<string, string>, requestId: string, decision = "allow", headers: Record<string, string> = { origin: BASE, "sec-fetch-site": "same-origin" }): Request {
  return new Request(`${BASE}${routes.nativeConfirm()}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: header(jar), ...headers },
    body: new URLSearchParams({ request: requestId, decision }),
  });
}

/** Confirms in the browser and reads the code off the loopback redirect. */
async function confirmed(jar: Map<string, string>, requestId: string): Promise<string> {
  const response = await confirm(confirmRequest(jar, requestId));
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get("location")!);
  expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
  expect(location.searchParams.get("state")).toBe("state-0123456789");
  return location.searchParams.get("code")!;
}

const exchange = (body: unknown, headers: Record<string, string> = DESKTOP) => post("/native/exchange", body, headers);

describe("the desktop's browser sign-in", () => {
  it("signs the desktop in as the person who confirmed, with its own session", async () => {
    const person = await signedUp();
    const { requestId, confirmation, expiresAt, verifier } = await started();
    expect(confirmation).toMatch(/^[A-Z2-9]{4}$/);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(120_000);
    expect(await findNativeRequest(auth, requestId)).toEqual({ confirmation });

    const code = await confirmed(person.jar, requestId);
    const response = await exchange({ requestId, code, codeVerifier: verifier });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: person.id, name: "Dana", email: person.email } });

    const desktop = cookiesOf(response);
    const session = await auth.api.getSession({ headers: new Headers({ cookie: header(desktop) }) });
    expect(session?.user.id).toBe(person.id);
    expect(session?.session.userAgent).toBe("Phean desktop");
    // A session of its own, not the browser's.
    expect(session?.session.token).not.toBe((await auth.api.getSession({ headers: new Headers({ cookie: header(person.jar) }) }))?.session.token);
  });

  it("sends a decline back to the app as access_denied, and uses the request up", async () => {
    const person = await signedUp();
    const { requestId } = await started();
    const response = await confirm(confirmRequest(person.jar, requestId, "decline"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${CALLBACK}?error=access_denied&state=state-0123456789`);
    expect(await findNativeRequest(auth, requestId)).toBeNull();
  });

  it("refuses a request it does not know, one already used, and one past its two minutes", async () => {
    const person = await signedUp();
    const unknown = randomBytes(32).toString("base64url");
    expect(await findNativeRequest(auth, unknown)).toBeNull();
    const refused = await confirm(confirmRequest(person.jar, unknown));
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe(`${BASE}${routes.nativeAuthorize(unknown)}`);

    const { requestId } = await started();
    await confirmed(person.jar, requestId);
    expect(await findNativeRequest(auth, requestId)).toBeNull();
    expect((await confirm(confirmRequest(person.jar, requestId))).headers.get("location")).toBe(`${BASE}${routes.nativeAuthorize(requestId)}`);

    const stale = await started();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 121_000);
    try {
      expect(await findNativeRequest(auth, stale.requestId)).toBeNull();
      expect(await decideNativeRequest(auth, { requestId: stale.requestId, userId: person.id, allow: true })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a code once, only with its verifier and its request, and only for two minutes", async () => {
    const person = await signedUp();
    const first = await started();
    const code = await confirmed(person.jar, first.requestId);
    expect((await exchange({ requestId: first.requestId, code, codeVerifier: first.verifier })).status).toBe(200);
    const replay = await exchange({ requestId: first.requestId, code, codeVerifier: first.verifier });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });

    const second = await started();
    const wrongVerifier = await exchange({ requestId: second.requestId, code: await confirmed(person.jar, second.requestId), codeVerifier: pkce().verifier });
    expect(wrongVerifier.status).toBe(400);
    expect(await wrongVerifier.json()).toMatchObject({ error: "invalid_grant" });

    const third = await started();
    const other = await started();
    const thirdCode = await confirmed(person.jar, third.requestId);
    // Bound to its request: another request's id does not take it.
    expect((await exchange({ requestId: other.requestId, code: thirdCode, codeVerifier: third.verifier })).status).toBe(400);

    const fourth = await started();
    const late = await confirmed(person.jar, fourth.requestId);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + (NATIVE_CODE_SECONDS + 1) * 1000);
    try {
      expect((await exchange({ requestId: fourth.requestId, code: late, codeVerifier: fourth.verifier })).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a confirm from a browser whose two-factor challenge is still pending", async () => {
    const person = await signedUp();
    const enabled = await post("/two-factor/enable", { password: PASSWORD }, { "content-type": "application/json", origin: BASE, cookie: header(person.jar) });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    expect((await post("/two-factor/verify-totp", { code: totpCode(totpURI) }, { "content-type": "application/json", origin: BASE, cookie: header(person.jar) })).status).toBe(200);

    // A new browser: the password is right, and the code is not entered yet.
    const signIn = await post("/sign-in/email", { email: person.email, password: PASSWORD }, { "content-type": "application/json", origin: BASE });
    expect(await signIn.clone().json()).toMatchObject({ twoFactorRedirect: true });
    const pending = cookiesOf(signIn);
    expect([...pending.keys()].some((name) => name.includes("two_factor"))).toBe(true);

    const { requestId } = await started();
    const response = await confirm(confirmRequest(pending, requestId));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${BASE}${routes.signIn(routes.nativeAuthorize(requestId))}`);
    // Nothing was used up or minted: the request is still waiting.
    expect(await findNativeRequest(auth, requestId)).not.toBeNull();
  });

  it("takes a confirm only as a same-origin form post", async () => {
    const person = await signedUp();
    const { requestId } = await started();
    expect((await confirm(confirmRequest(person.jar, requestId, "allow", {}))).status).toBe(403);
    expect((await confirm(confirmRequest(person.jar, requestId, "allow", { origin: "https://evil.example" }))).status).toBe(403);
    expect((await confirm(confirmRequest(person.jar, requestId, "allow", { origin: BASE, "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(await findNativeRequest(auth, requestId)).not.toBeNull();
  });

  it("refuses a start or an exchange that a browser could have sent", async () => {
    const person = await signedUp();
    const { requestId, verifier } = await started();
    const code = await confirmed(person.jar, requestId);
    const body = { requestId, code, codeVerifier: verifier };

    for (const headers of [
      { "content-type": "application/json" },
      { ...DESKTOP, "phean-client": "web" },
      { ...DESKTOP, origin: BASE },
      { ...DESKTOP, "sec-fetch-site": "same-origin" },
      { ...DESKTOP, "sec-fetch-site": "none" },
      { ...DESKTOP, "content-type": "text/plain" },
      { ...DESKTOP, cookie: header(person.jar) },
    ]) {
      const response = await exchange(body, headers);
      expect(response.status, JSON.stringify(headers)).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
    }
    for (const headers of [{ "content-type": "application/json" }, { ...DESKTOP, origin: BASE }, { ...DESKTOP, "sec-fetch-site": "cross-site" }]) {
      expect((await start({}, headers)).response.status, JSON.stringify(headers)).toBe(400);
    }
    // None of those used the code up, and a cookie that is not a session's is no obstacle.
    const response = await exchange(body, { ...DESKTOP, cookie: "phean-theme=dusk" });
    expect(response.status).toBe(200);
    // Only the one session from the exchange was minted for the desktop.
    const sessions = await testDb.db.select().from(sessionTable).where(eq(sessionTable.userId, person.id));
    expect(sessions.filter((row) => row.userAgent === "Phean desktop")).toHaveLength(1);
  });

  it("registers only the app's loopback callback and a well-formed request", async () => {
    for (const redirectUri of [
      "http://localhost:43123/callback",
      "https://127.0.0.1:43123/callback",
      "http://127.0.0.1:80/callback",
      "http://127.0.0.1:1023/callback",
      "http://127.0.0.1:65536/callback",
      "http://127.0.0.1:043123/callback",
      "http://127.0.0.1/callback",
      "http://127.0.0.1:43123/callback?next=x",
      "http://127.0.0.1:43123/callback#x",
      "http://127.0.0.1:43123/other",
      "http://user@127.0.0.1:43123/callback",
      "http://127.0.0.1.evil.example:43123/callback",
      "phean://callback",
    ]) {
      expect(isLoopbackCallback(redirectUri), redirectUri).toBe(false);
      const { response } = await start({ redirectUri });
      expect(response.status, redirectUri).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_request" });
    }
    expect(isLoopbackCallback("http://127.0.0.1:1024/callback")).toBe(true);
    expect(isLoopbackCallback("http://127.0.0.1:65535/callback")).toBe(true);
    expect((await start({ client: "web" })).response.status).toBe(400);
    expect((await start({ codeChallenge: "short" })).response.status).toBe(400);
    expect((await start({ state: "" })).response.status).toBe(400);
  });

  it.each(["/native/:path*", "/oauth/:path*"])("refuses frames on %s, the two ways browsers read it, with no form-action", async (path) => {
    const rules = (await nextConfig.headers!()).filter(({ source }) => source === path);
    expect(rules).toHaveLength(1);
    const headers = Object.fromEntries(rules[0]!.headers.map(({ key, value }) => [key.toLowerCase(), value]));
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    // form-action would also apply to the 303 to the app's loopback address and to OAuth client redirects.
    expect(headers["content-security-policy"]).not.toContain("form-action");
  });

  it("is rate limited per address at both ends", () => {
    const rules = auth.options.plugins.flatMap((plugin) => ("rateLimit" in plugin ? (plugin.rateLimit ?? []) : []));
    expect(rules.find((rule) => rule.pathMatcher("/native/start"))).toMatchObject(NATIVE_START_LIMIT);
    expect(rules.find((rule) => rule.pathMatcher("/native/exchange"))).toMatchObject(NATIVE_EXCHANGE_LIMIT);
  });
});
