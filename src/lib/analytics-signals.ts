/**
 * One-shot analytics signals (docs/ANALYTICS.md): what only the server sees happen (a sign-up or
 * sign-in through GitHub or Google, a workspace created or deleted or an invitation accepted by an action that
 * redirects) handed to the next page, whose `AnalyticsSignals` sends it with `track` and deletes it.
 * The cookie carries catalog enums only, never a name, email, slug or id, lives ten minutes, and the
 * server sets it only for a visitor who accepted analytics. Client-safe.
 */

import { MEMBER_ROLES, type MemberRole } from "./domain";

export const SIGNAL_COOKIE = "phean-ga-signal";

/** Attributes for setting it (add `secure` on https): readable by the page, which deletes it once sent. */
export const SIGNAL_COOKIE_OPTIONS = { path: "/", maxAge: 10 * 60, sameSite: "lax", httpOnly: false } as const;

export const SIGN_IN_METHODS = ["password", "github", "google"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

export type AnalyticsSignal =
  | { event: "sign_up"; method: SignInMethod }
  | { event: "login"; method: SignInMethod }
  | { event: "workspace_create" }
  | { event: "workspace_delete" }
  | { event: "invite_accept"; role: MemberRole };

/** At most this many wait in the cookie; the oldest go first. */
const MAX_SIGNALS = 4;
const SEPARATOR = "~";

/** How a Better Auth account signs in: its `providerId` as the catalog's `method`, or null for anything else. */
export function methodOfProvider(providerId: string | null | undefined): SignInMethod | null {
  if (providerId === "credential") return "password";
  return providerId === "github" || providerId === "google" ? providerId : null;
}

function encode(signal: AnalyticsSignal): string {
  if (signal.event === "workspace_create" || signal.event === "workspace_delete") return signal.event;
  return `${signal.event}.${signal.event === "invite_accept" ? signal.role : signal.method}`;
}

function decode(part: string): AnalyticsSignal | null {
  const [event, value = ""] = part.split(".");
  if ((event === "workspace_create" || event === "workspace_delete") && !value) return { event };
  if ((event === "sign_up" || event === "login") && (SIGN_IN_METHODS as readonly string[]).includes(value)) return { event, method: value as SignInMethod };
  if (event === "invite_accept" && (MEMBER_ROLES as readonly string[]).includes(value)) return { event, role: value as MemberRole };
  return null;
}

/** The signals in a cookie's value; anything that is not one is dropped. */
export function parseSignals(value: string | null | undefined): AnalyticsSignal[] {
  if (!value) return [];
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return [];
  }
  return decoded
    .split(SEPARATOR)
    .map(decode)
    .filter((signal): signal is AnalyticsSignal => signal !== null);
}

/** The cookie's value with `signal` added after what is already waiting. */
export function appendSignal(existing: string | null | undefined, signal: AnalyticsSignal): string {
  return [...parseSignals(existing), signal].slice(-MAX_SIGNALS).map(encode).join(SEPARATOR);
}

/** Whether the request's visitor accepted analytics, from its `phean-consent` cookie. */
export const consented = (consent: string | null | undefined): boolean => consent === "granted";

/** In the browser: the waiting signals, deleting the cookie so each is sent once. */
export function takeSignals(): AnalyticsSignal[] {
  if (typeof document === "undefined") return [];
  const pair = document.cookie.split(";").find((cookie) => cookie.trim().startsWith(`${SIGNAL_COOKIE}=`));
  if (!pair) return [];
  document.cookie = `${SIGNAL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  return parseSignals(pair.trim().slice(SIGNAL_COOKIE.length + 1));
}
