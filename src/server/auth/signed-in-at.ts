/**
 * `session.signedInAt`: when the person last proved who they are. Better Auth's own `createdAt` says
 * only when a session row was made, and sessions are made from other sessions (two-factor turned on,
 * the desktop handoff), so a fresh row is no proof of a fresh sign-in. Deleting a workspace without a
 * password reads this instead (`isRecentSignIn`).
 *
 * Set to now only where a person authenticates: a password sign-in or sign-up, a provider's callback,
 * the two-factor step of a sign-in, and a password change (it asks for the current one). A session
 * made from another one carries the parent's value over (Better Auth copies the parent's fields into
 * the new row, `signedInAt` among them, even when it is null), and the desktop handoff copies it
 * explicitly (`native.ts`); neither ever gets "now".
 */

/** Better Auth's endpoints where a person proves who they are and a session is made for it. */
const SIGN_IN_PATHS = new Set(["/sign-in/email", "/sign-up/email", "/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/verify-otp", "/change-password"]);

export function isSignInPath(path: string | undefined): boolean {
  if (!path) return false;
  return SIGN_IN_PATHS.has(path) || path.startsWith("/callback/");
}

/** The session field, declared to Better Auth so it reads and writes it; never taken from a request body. */
export const signedInAtField = { signedInAt: { type: "date", required: false, input: false } } as const;

/**
 * `databaseHooks.session.create.before`: stamps a session made by signing in. One made from another
 * session already carries the key (the parent's value, or null), and keeps it.
 */
export async function stampSignIn(session: Record<string, unknown>, context: { path?: string } | null): Promise<{ data: Record<string, unknown> } | void> {
  if ("signedInAt" in session) return;
  return { data: { ...session, signedInAt: isSignInPath(context?.path) ? new Date() : null } };
}
