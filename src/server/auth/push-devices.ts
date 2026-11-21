import { getSessionFromCtx } from "better-auth/api";

import type { Db } from "../db/client";
import { forgetSessionDevices, sessionIdOfToken, sessionIdsOf } from "../domain/notifications";

type HookContext = Parameters<typeof getSessionFromCtx>[0];

/** The Better Auth endpoints that end sessions, which end the devices turned on in them. */
export const SESSION_ENDING_PATHS = new Set(["/sign-out", "/revoke-session", "/revoke-sessions", "/revoke-other-sessions", "/change-password"]);

/**
 * Before a session ends, its notification devices go: signing out, revoking a session (one, all,
 * or all but this one) from the Account page, and changing the password with "sign out everywhere
 * else". It runs first because the sessions' rows are gone afterwards, so a password change that then
 * fails (a mistyped current password) has still signed the other devices out of notifications,
 * which revoking those sessions would have done anyway. A session that merely
 * expires keeps its devices, so a person who was away still hears about decisions.
 */
export async function endSessionDevices(database: Db, ctx: HookContext & { path: string; body?: unknown }): Promise<void> {
  if (!SESSION_ENDING_PATHS.has(ctx.path)) return;
  const current = await getSessionFromCtx(ctx, { disableRefresh: true });
  if (!current) return;
  const { session, user } = current;
  const body = (ctx.body ?? {}) as { token?: unknown; revokeOtherSessions?: unknown };
  let ending: string[] = [];
  if (ctx.path === "/sign-out") ending = [session.id];
  if (ctx.path === "/revoke-sessions") ending = await sessionIdsOf(database, user.id);
  if (ctx.path === "/revoke-other-sessions") ending = await sessionIdsOf(database, user.id, { except: session.id });
  if (ctx.path === "/change-password" && body.revokeOtherSessions === true) ending = await sessionIdsOf(database, user.id, { except: session.id });
  if (ctx.path === "/revoke-session" && typeof body.token === "string") {
    const id = await sessionIdOfToken(database, user.id, body.token);
    if (id) ending = [id];
  }
  await forgetSessionDevices(database, ending);
}
