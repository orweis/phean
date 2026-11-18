import { createHmac, timingSafeEqual } from "node:crypto";

import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";

import { routes } from "@/lib/routes";
import { TRUST_DEVICE_DAYS, TWO_FACTOR_CHALLENGE_MINUTES } from "@/lib/two-factor";

/** The plugin's cookie names and lifetimes; the challenge below must read exactly as one it set itself. */
const TWO_FACTOR_COOKIE = "two_factor";
const TRUST_DEVICE_COOKIE = "trust_device";
export const TWO_FACTOR_CHALLENGE_SECONDS = TWO_FACTOR_CHALLENGE_MINUTES * 60;
export const TRUST_DEVICE_SECONDS = TRUST_DEVICE_DAYS * 24 * 60 * 60;

/** The plugin's trust-device token: an HMAC of `userId!identifier` under the auth secret. */
function trustToken(secret: string, userId: string, identifier: string): string {
  return createHmac("sha256", secret).update(`${userId}!${identifier}`).digest("base64url");
}

/** Whether a "trust this browser" cookie's value is the plugin's token for this person. */
function isTrustToken(value: string | null, secret: string, userId: string): string | null {
  if (!value) return null;
  const [token = "", identifier = ""] = value.split("!");
  const expected = Buffer.from(trustToken(secret, userId, identifier));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected) ? identifier : null;
}

/** Where the provider callback was about to send the person, as a path on this site. */
function redirectTarget(returned: unknown, baseUrl: string): string | undefined {
  const headers = (returned as { headers?: Headers | Record<string, string> } | null)?.headers;
  const location = headers instanceof Headers ? headers.get("location") : (headers?.Location ?? headers?.location);
  if (!location) return undefined;
  const url = new URL(location, baseUrl);
  return url.origin === new URL(baseUrl).origin ? `${url.pathname}${url.search}` : undefined;
}

/**
 * Better Auth's two-factor plugin asks for the second factor only after a password sign-in. A person
 * who turns on two-factor means it for every way in, so a GitHub or Google sign-in gets the same
 * challenge: the session the callback just made is thrown away, the plugin's own pending-challenge
 * cookie is set, and the person lands on the code page, which finishes through the plugin's
 * verify endpoints. A browser they told to trust skips it, as it does for a password sign-in.
 */
export function providerSignInChallenge(baseUrl: string) {
  return createAuthMiddleware(async (ctx) => {
    if (!ctx.path.startsWith("/callback/")) return;
    const signedIn = ctx.context.newSession;
    if (!signedIn || !(signedIn.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) return;
    const { user } = signedIn;

    const trustCookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE, { maxAge: TRUST_DEVICE_SECONDS });
    const trusted = isTrustToken((await ctx.getSignedCookie(trustCookie.name, ctx.context.secret)) || null, ctx.context.secret, user.id);
    if (trusted) {
      const record = await ctx.context.internalAdapter.findVerificationValue(trusted);
      if (record?.value === user.id && record.expiresAt > new Date()) return;
    }

    const next = redirectTarget(ctx.context.returned, baseUrl);
    deleteSessionCookie(ctx, true);
    await ctx.context.internalAdapter.deleteSession(signedIn.session.token);
    ctx.context.setNewSession(null);

    const identifier = `2fa-${generateRandomString(20)}`;
    const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_SECONDS * 1000);
    await ctx.context.internalAdapter.createVerificationValue({ value: user.id, identifier, expiresAt });
    await ctx.context.internalAdapter.createVerificationValue({ value: "0", identifier: `2fa-attempts-${identifier}`, expiresAt });
    const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE, { maxAge: TWO_FACTOR_CHALLENGE_SECONDS });
    await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
    throw ctx.redirect(`${baseUrl}${routes.twoFactor(next)}`);
  });
}
