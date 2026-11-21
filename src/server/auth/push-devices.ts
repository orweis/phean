import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";

import type { Db } from "../db/client";
import { devicesOfSessions, forgetDevicesById, forgetSessionDevices, moveDevicesToSession, sessionIdOfToken, sessionIdsOf } from "../domain/notifications";

type HookContext = Parameters<typeof getSessionFromCtx>[0];

/** The Better Auth endpoints that end sessions, which end the devices turned on in them. */
export const SESSION_ENDING_PATHS = new Set(["/sign-out", "/revoke-session", "/revoke-sessions", "/revoke-other-sessions"]);

/**
 * The endpoints that replace the browser's own session with a new one (deleting the old row, which
 * would leave its devices tied to nothing): a password change that signs out everywhere else, and
 * turning two-factor on or off.
 */
export const SESSION_ROTATING_PATHS = new Set(["/change-password", "/two-factor/enable", "/two-factor/disable", "/two-factor/verify-totp", "/two-factor/verify-otp"]);

/** What the `before` hook hands its `after` hook, on the endpoint's context. */
interface Pending {
  sessionId: string;
  userId: string;
  /** The devices turned on in this browser's session, which follow it to its new one. */
  follow: string[];
  /** The devices of the sessions the call is about to end, which go only if it succeeds. */
  end: string[];
}

const PENDING = "pheanPushDevices";

/**
 * Before a session ends, its notification devices go: signing out, and revoking a session (one,
 * all, or all but this one) from the Account page. It runs first because the sessions' rows are
 * gone afterwards. A session that merely expires keeps its devices, so a person who was away still
 * hears about decisions; the browser ties its device to its new session when the app loads
 * (`tieDevice`), and forgets it by endpoint when it signs out (`forgetBrowserDevice`).
 */
export async function endSessionDevices(database: Db, ctx: HookContext & { path: string; body?: unknown }): Promise<void> {
  if (!SESSION_ENDING_PATHS.has(ctx.path)) return;
  const current = await getSessionFromCtx(ctx, { disableRefresh: true });
  if (!current) return;
  const { session, user } = current;
  const body = (ctx.body ?? {}) as { token?: unknown };
  let ending: string[] = [];
  if (ctx.path === "/sign-out") ending = [session.id];
  if (ctx.path === "/revoke-sessions") ending = await sessionIdsOf(database, user.id);
  if (ctx.path === "/revoke-other-sessions") ending = await sessionIdsOf(database, user.id, { except: session.id });
  if (ctx.path === "/revoke-session" && typeof body.token === "string") {
    const id = await sessionIdOfToken(database, user.id, body.token);
    if (id) ending = [id];
  }
  await forgetSessionDevices(database, ending);
}

/**
 * Before a call that may rotate this browser's session: which devices follow it, and which go with
 * the other sessions a password change signs out. Nothing changes yet, so a call that fails (a
 * mistyped current password) leaves every device as it was.
 */
async function noteRotation(database: Db, ctx: HookContext & { path: string; body?: unknown }): Promise<Pending | null> {
  if (!SESSION_ROTATING_PATHS.has(ctx.path)) return null;
  const current = await getSessionFromCtx(ctx, { disableRefresh: true });
  if (!current) return null;
  const { session, user } = current;
  const body = (ctx.body ?? {}) as { revokeOtherSessions?: unknown };
  const others = ctx.path === "/change-password" && body.revokeOtherSessions === true ? await sessionIdsOf(database, user.id, { except: session.id }) : [];
  return { sessionId: session.id, userId: user.id, follow: await devicesOfSessions(database, [session.id]), end: await devicesOfSessions(database, others) };
}

/** After the call: only if it succeeded, the other sessions' devices go and this browser's follow its new session. */
async function settleRotation(database: Db, ctx: { context: { returned?: unknown; newSession?: { session: { id: string } } | null } }, pending: Pending): Promise<void> {
  const returned = ctx.context.returned;
  if (returned === undefined || isAPIError(returned) || (returned instanceof Response && !returned.ok)) return;
  await forgetDevicesById(database, pending.userId, pending.end);
  const next = ctx.context.newSession?.session.id;
  if (next && next !== pending.sessionId) await moveDevicesToSession(database, pending.userId, pending.follow, next);
}

/**
 * Keeps notification devices with the sessions that turned them on: they end with their session,
 * and follow it when Better Auth replaces it with a new one.
 */
export function pushDeviceSessions(database: Db) {
  return {
    id: "phean-push-devices",
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => SESSION_ENDING_PATHS.has(ctx.path ?? "") || SESSION_ROTATING_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            await endSessionDevices(database, ctx);
            const pending = await noteRotation(database, ctx);
            if (pending) return { context: { [PENDING]: pending } };
          }),
        },
      ],
      after: [
        {
          matcher: (ctx: { path?: string }) => SESSION_ROTATING_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const pending = (ctx as unknown as Record<string, Pending | undefined>)[PENDING];
            if (pending) await settleRotation(database, ctx, pending);
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
