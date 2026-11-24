import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";

import { CONSENT_COOKIE } from "@/lib/analytics";
import { appendSignal, consented, methodOfProvider, SIGNAL_COOKIE, SIGNAL_COOKIE_OPTIONS, type AnalyticsSignal } from "@/lib/analytics-signals";

import { sendServerEvents } from "../analytics";
import { appUrl } from "../config";
import type { Db } from "../db/client";
import { account as accountTable } from "../db/schema/auth";

/**
 * Analytics for signing up and in (docs/ANALYTICS.md, "Auth and onboarding"). The server's `sign_up`
 * is the source of truth; the browser's copies come from the forms, or, where only the server sees
 * what happened (a provider's callback, an action that redirects), from a one-shot signal cookie
 * (`lib/analytics-signals.ts`). Nothing here may fail a sign-in, so every step swallows its errors.
 */

/**
 * Sends `sign_up` when a person's first account is created: a password (`credential`), GitHub or
 * Google. Better Auth runs `account.create.after` once the account is committed; connecting a
 * second way in later (account linking) finds an older account and sends nothing.
 */
export async function reportSignUp(database: Db, created: { id: string; userId: string; providerId: string }): Promise<void> {
  try {
    const method = methodOfProvider(created.providerId);
    if (!method) return;
    const [older] = await database
      .select({ id: accountTable.id })
      .from(accountTable)
      .where(and(eq(accountTable.userId, created.userId), ne(accountTable.id, created.id)))
      .limit(1);
    if (older) return;
    sendServerEvents({ name: "sign_up", params: { method }, userId: created.userId });
  } catch {
    // Analytics never fails a sign-up.
  }
}

/** A person is new if their user row was made with this session (the callback creates both). */
const NEW_ACCOUNT_MS = 60_000;

/** What a provider's callback hook can see; Better Auth's middleware context has all of it. */
export interface ProviderCallbackContext {
  params?: Record<string, string | undefined>;
  getCookie(name: string): string | null | undefined;
  setCookie(name: string, value: string, options: { path: string; maxAge: number; sameSite: "lax"; httpOnly: boolean; secure: boolean }): unknown;
  context: { newSession: { user: { createdAt: Date | string }; session: { createdAt: Date | string } } | null };
}

/**
 * After a GitHub or Google callback made a session: tells the next page it was a `sign_up` or a
 * `login`, for a visitor who accepted analytics. When two-factor then asks for a code, the code page
 * reads the method from the same cookie and sends the `login` itself.
 */
export function signalProviderSignIn(ctx: ProviderCallbackContext, baseUrl: string): void {
  try {
    const signedIn = ctx.context.newSession;
    const method = methodOfProvider(ctx.params?.id);
    if (!signedIn || !method || method === "password" || !consented(ctx.getCookie(CONSENT_COOKIE))) return;
    const age = new Date(signedIn.session.createdAt).getTime() - new Date(signedIn.user.createdAt).getTime();
    const signal: AnalyticsSignal = age < NEW_ACCOUNT_MS ? { event: "sign_up", method } : { event: "login", method };
    ctx.setCookie(SIGNAL_COOKIE, appendSignal(ctx.getCookie(SIGNAL_COOKIE), signal), { ...SIGNAL_COOKIE_OPTIONS, secure: baseUrl.startsWith("https:") });
  } catch {
    // Analytics never fails a sign-in.
  }
}

/** From a server action that redirects: queues `signal` for the next page, if the visitor accepted analytics. */
export async function queueAnalyticsSignal(signal: AnalyticsSignal): Promise<void> {
  try {
    const jar = await cookies();
    if (!consented(jar.get(CONSENT_COOKIE)?.value)) return;
    jar.set(SIGNAL_COOKIE, appendSignal(jar.get(SIGNAL_COOKIE)?.value, signal), { ...SIGNAL_COOKIE_OPTIONS, secure: appUrl().startsWith("https:") });
  } catch {
    // Analytics never fails the action.
  }
}
