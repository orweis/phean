import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { getSessionCookie, setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

import { routes } from "@/lib/routes";

import type { Auth } from "./auth";

/**
 * The desktop app's sign-in through the system browser: a loopback redirect (RFC 8252 §7.3) with PKCE,
 * as docs/apps/CONTRACTS.md ("Desktop sign-in handoff") states it.
 *
 * 1. The app registers a request (`POST /api/auth/native/start`).
 * 2. The person confirms it in their browser at `/native/authorize`, which needs a full session: every
 *    way of signing in, two-factor included, has already finished. That mints a one-time code.
 * 3. The browser is sent 303 to the app's loopback address with the code, and the app trades it, with
 *    its PKCE verifier, for a session of its own (`POST /api/auth/native/exchange`).
 *
 * So this path mints a session only from a full session, never from a credential of its own.
 */

/** How long a registered request may wait to be confirmed, and how long its code may wait to be traded. */
/** Long enough to sign in from scratch in the browser (a password and a code); the code itself still lasts two minutes. */
export const NATIVE_REQUEST_SECONDS = 600;
export const NATIVE_CODE_SECONDS = 120;
/** The session's user agent, which `/account`'s session list shows. */
export const NATIVE_USER_AGENT = "Phean desktop";
/** Per address, a minute, on each endpoint. */
export const NATIVE_START_LIMIT = { window: 60, max: 10 };
export const NATIVE_EXCHANGE_LIMIT = { window: 60, max: 10 };

const START_PATH = "/native/start";
const EXCHANGE_PATH = "/native/exchange";
const REQUEST_PREFIX = "native-request:";
const CODE_PREFIX = "native-code:";
/** The confirmation code's letters: no 0/O, 1/I/L, so a person can compare it at a glance. */
const CONFIRMATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CONFIRMATION_LENGTH = 4;

const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** Request ids are 32 random bytes, base64url. */
const REQUEST_ID = /^[A-Za-z0-9_-]{43}$/;

/**
 * The app's loopback callback, and nothing else: `http://127.0.0.1:<1024-65535>/callback`, with no
 * user info, query or fragment. `localhost` is refused because it can resolve elsewhere (RFC 8252 §8.3).
 */
export function isLoopbackCallback(uri: string): boolean {
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{3,4})\/callback$/.exec(uri);
  if (!match) return false;
  const port = Number(match[1]);
  return port >= 1024 && port <= 65535;
}

export const NativeStartInput = z.object({
  client: z.literal("desktop"),
  /** base64url(sha256(verifier)): 43 characters. */
  codeChallenge: z.string().length(43).regex(BASE64URL),
  redirectUri: z.string().max(64).refine(isLoopbackCallback),
  /** Echoed back on the callback; printable ASCII. */
  state: z.string().min(8).max(512).regex(/^[\x21-\x7e]+$/),
});

export const NativeExchangeInput = z.object({
  requestId: z.string().regex(REQUEST_ID),
  code: z.string().length(43).regex(BASE64URL),
  /** RFC 7636 §4.1. */
  codeVerifier: z.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/),
});

interface StoredRequest {
  codeChallenge: string;
  redirectUri: string;
  state: string;
  confirmation: string;
}

interface StoredCode {
  requestId: string;
  userId: string;
  codeChallenge: string;
  /** The confirming session's sign-in time, which the desktop's session carries over (never "now"). */
  signedInAt: string | null;
}

/** The parts of Better Auth's internal adapter this file uses: its `verification` table. */
interface VerificationStore {
  createVerificationValue(data: { identifier: string; value: string; expiresAt: Date }): Promise<unknown>;
  findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date } | null>;
  consumeVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date } | null>;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");

function equalInConstantTime(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function confirmationCode(): string {
  return Array.from({ length: CONFIRMATION_LENGTH }, () => CONFIRMATION_ALPHABET[randomInt(CONFIRMATION_ALPHABET.length)]).join("");
}

function parse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

/**
 * Why a request to the app-only endpoints is refused, or null. Only the desktop's main process may
 * call them: it sends `Phean-Client: desktop` and JSON, and no browser headers. A page cannot send the
 * custom header cross-origin without a preflight, which Phean never answers, and a browser adds
 * `Origin`, or a `Sec-Fetch-Site` other than `none`, to what a page sends. Electron's own network
 * stack (`session.fetch` from main, which honours the system proxy and certificate store) sends
 * `Sec-Fetch-Site: none` and no `Origin`; no page can send `none`.
 */
function appOnlyRefusal(headers: Headers): string | null {
  if (headers.get("phean-client") !== "desktop") return "Phean-Client: desktop is required";
  const site = headers.get("sec-fetch-site");
  if (headers.has("origin") || (site !== null && site !== "none")) return "browser requests are refused";
  if (!/^application\/json(;|$)/i.test(headers.get("content-type") ?? "")) return "the body must be JSON";
  return null;
}

const invalidRequest = () => Response.json({ error: "invalid_request" }, { status: 400, headers: { "cache-control": "no-store" } });

/** The Better Auth plugin: `/api/auth/native/start` and `/api/auth/native/exchange`. */
export function nativeSignIn() {
  return {
    id: "phean-native-sign-in",
    /**
     * The header rules, before Better Auth's own origin check. The exchange must not carry a session
     * (a page could otherwise swap the person's session for another one), and once that is checked the
     * cookies are dropped: Better Auth asks for an `Origin` whenever there are cookies, and these
     * requests must never carry one. The rules above are the stronger guard.
     */
    onRequest: async (request: Request, ctx: { baseURL: string }) => {
      const path = new URL(request.url).pathname.slice(new URL(ctx.baseURL).pathname.replace(/\/$/, "").length);
      if (path !== START_PATH && path !== EXCHANGE_PATH) return;
      if (appOnlyRefusal(request.headers)) return { response: invalidRequest() };
      if (path === EXCHANGE_PATH && getSessionCookie(request.headers)) return { response: invalidRequest() };
      const headers = new Headers(request.headers);
      headers.delete("cookie");
      return { request: new Request(request, { headers }) };
    },
    endpoints: {
      nativeStart: createAuthEndpoint(START_PATH, { method: "POST" }, async (ctx) => {
        if (!ctx.request || appOnlyRefusal(ctx.request.headers)) throw new APIError("BAD_REQUEST", { error: "invalid_request" });
        const input = NativeStartInput.safeParse(ctx.body);
        if (!input.success) throw new APIError("BAD_REQUEST", { error: "invalid_request" });
        const { codeChallenge, redirectUri, state } = input.data;
        const requestId = randomBytes(32).toString("base64url");
        const confirmation = confirmationCode();
        const expiresAt = later(NATIVE_REQUEST_SECONDS);
        const stored: StoredRequest = { codeChallenge, redirectUri, state, confirmation };
        await ctx.context.internalAdapter.createVerificationValue({ identifier: `${REQUEST_PREFIX}${requestId}`, value: JSON.stringify(stored), expiresAt });
        ctx.setHeader("cache-control", "no-store");
        return ctx.json({ requestId, confirmation, expiresAt: expiresAt.toISOString() });
      }),
      nativeExchange: createAuthEndpoint(EXCHANGE_PATH, { method: "POST" }, async (ctx) => {
        if (!ctx.request || appOnlyRefusal(ctx.request.headers)) throw new APIError("BAD_REQUEST", { error: "invalid_request" });
        const input = NativeExchangeInput.safeParse(ctx.body);
        if (!input.success) throw new APIError("BAD_REQUEST", { error: "invalid_request" });
        const { requestId, code, codeVerifier } = input.data;
        // Found by its hash, and gone once read: a code works once, right or wrong.
        const record = await ctx.context.internalAdapter.consumeVerificationValue(`${CODE_PREFIX}${sha256(code)}`);
        const stored = record ? parse<StoredCode>(record.value) : null;
        if (
          !stored ||
          !equalInConstantTime(requestId, stored.requestId) ||
          !equalInConstantTime(sha256(codeVerifier), stored.codeChallenge)
        ) {
          throw new APIError("BAD_REQUEST", { error: "invalid_grant" });
        }
        const user = await ctx.context.internalAdapter.findUserById(stored.userId);
        if (!user) throw new APIError("BAD_REQUEST", { error: "invalid_grant" });
        // The browser session's sign-in time, not this moment: a handoff is not a sign-in (signed-in-at.ts).
        const signedInAt = stored.signedInAt ? new Date(stored.signedInAt) : null;
        const session = await ctx.context.internalAdapter.createSession(user.id, false, { userAgent: NATIVE_USER_AGENT, signedInAt });
        await setSessionCookie(ctx, { session, user });
        console.info(`[auth] desktop session minted for user ${user.id}`);
        ctx.setHeader("cache-control", "no-store");
        return ctx.json({ user: { id: user.id, name: user.name, email: user.email } });
      }),
    },
    rateLimit: [
      { pathMatcher: (path: string) => path === START_PATH, ...NATIVE_START_LIMIT },
      { pathMatcher: (path: string) => path === EXCHANGE_PATH, ...NATIVE_EXCHANGE_LIMIT },
    ],
  } satisfies BetterAuthPlugin;
}

async function verificationStore(provider: Auth): Promise<VerificationStore> {
  return (await provider.$context).internalAdapter;
}

/** What `/native/authorize` shows for a request, or null when it is unknown, expired or already used. */
export async function findNativeRequest(provider: Auth, requestId: string): Promise<{ confirmation: string } | null> {
  if (!REQUEST_ID.test(requestId)) return null;
  const record = await (await verificationStore(provider)).findVerificationValue(`${REQUEST_PREFIX}${requestId}`);
  const stored = record && record.expiresAt > new Date() ? parse<StoredRequest>(record.value) : null;
  return stored ? { confirmation: stored.confirmation } : null;
}

/**
 * The person's answer to a request, for the user of a full session. The request is used up either
 * way. Confirming stores a one-time code (32 random bytes, kept only as a hash) bound to the request,
 * the user and the challenge. Returns the loopback address to send the browser to, or null when the
 * request is unknown, expired or already used.
 */
export async function decideNativeRequest(
  provider: Auth,
  { requestId, userId, allow, signedInAt = null }: { requestId: string; userId: string; allow: boolean; signedInAt?: Date | string | null },
): Promise<string | null> {
  if (!REQUEST_ID.test(requestId)) return null;
  const store = await verificationStore(provider);
  const record = await store.consumeVerificationValue(`${REQUEST_PREFIX}${requestId}`);
  const stored = record ? parse<StoredRequest>(record.value) : null;
  // Checked again: the redirect is only ever the app's loopback address.
  if (!stored || !isLoopbackCallback(stored.redirectUri)) return null;
  const callback = new URL(stored.redirectUri);
  if (!allow) {
    callback.searchParams.set("error", "access_denied");
    callback.searchParams.set("state", stored.state);
    return callback.toString();
  }
  const code = randomBytes(32).toString("base64url");
  const bound: StoredCode = { requestId, userId, codeChallenge: stored.codeChallenge, signedInAt: signedInAt ? new Date(signedInAt).toISOString() : null };
  await store.createVerificationValue({ identifier: `${CODE_PREFIX}${sha256(code)}`, value: JSON.stringify(bound), expiresAt: later(NATIVE_CODE_SECONDS) });
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", stored.state);
  return callback.toString();
}

const see = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/**
 * `POST /native/authorize/confirm`, the form on `/native/authorize`. A route handler rather than a
 * server action, so the browser gets a plain 303 to the loopback address. It takes only a same-origin
 * form post from a browser with a full session; without one, the person signs in and comes back.
 */
export function nativeConfirmRoute(provider: Auth, baseUrl: string): (request: Request) => Promise<Response> {
  return async (request) => {
    const context = await provider.$context;
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (!origin || !context.trustedOrigins.includes(origin) || (site !== null && site !== "same-origin")) {
      return new Response("This sign-in must be confirmed on Phean's own page.", { status: 403 });
    }
    const form = await request.formData().catch(() => null);
    const requestId = String(form?.get("request") ?? "");
    const back = new URL(routes.nativeAuthorize(requestId), baseUrl).toString();
    // A pending two-factor challenge is not a session, so it lands here too.
    const session = await provider.api.getSession({ headers: request.headers });
    if (!session) return see(new URL(routes.signIn(routes.nativeAuthorize(requestId)), baseUrl).toString());
    const allow = form?.get("decision") === "allow";
    const target = await decideNativeRequest(provider, { requestId, userId: session.user.id, allow, signedInAt: session.session.signedInAt ?? null });
    return see(target ?? back);
  };
}
