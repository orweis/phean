import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { account, twoFactor, user, verification } from "../db/schema";
import { forbidden } from "../domain/errors";
import type { Reauth } from "../domain/workspace-deletion";
import type { Auth } from "./auth";

/** Wrong passwords allowed in a row before re-authentication locks, and for how long it then stays locked. */
export const REAUTH_MAX_FAILURES = 5;
export const REAUTH_LOCK_MINUTES = 15;
/** Better Auth's two-factor plugin locks after this many failed codes, for this long (its defaults, which Phean keeps). */
const TOTP_MAX_FAILURES = 10;
const TOTP_LOCK_MS = 15 * 60_000;

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
/** Secrets imported from other providers are stored as `base32:<secret>` (as the plugin reads them). */
const BASE32_PREFIX = "base32:";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index >= 0) bits += index.toString(2).padStart(5, "0");
  }
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
}

/** RFC 6238 (SHA-1, 30-second steps, six digits), as the plugin's own check: this step and one either side. */
function totpMatches(key: Buffer, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  let matched = false;
  for (const offset of [-1, 0, 1]) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step + offset));
    const hash = createHmac("sha1", key).update(counter).digest();
    const start = hash[hash.length - 1]! & 0xf;
    const expected = String((hash.readUInt32BE(start) & 0x7fffffff) % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
    matched = timingSafeEqual(Buffer.from(expected), Buffer.from(code)) || matched;
  }
  return matched;
}

/** The row in `verification` that counts a person's wrong passwords at re-authentication. */
const failureKey = (userId: string) => `reauth-failures-${userId}`;

/**
 * Re-authentication for a sensitive change (deleting a workspace), checked on the server against
 * Better Auth's own records: the password hash on the person's credential account, and the
 * authenticator secret the two-factor plugin keeps, decrypted with the auth secret. Wrong passwords
 * lock it for a while after `REAUTH_MAX_FAILURES`; wrong codes count toward the plugin's own
 * two-factor lockout, which also guards signing in.
 */
export function reauthWith(provider: Auth, db: Db): Reauth {
  return {
    async factors(userId) {
      const [credential] = await db
        .select({ password: account.password })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
      const [person] = await db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, userId));
      return { password: Boolean(credential?.password), twoFactor: Boolean(person?.twoFactorEnabled) };
    },

    async verifyPassword(userId, password) {
      const identifier = failureKey(userId);
      const [counter] = await db.select({ value: verification.value, expiresAt: verification.expiresAt }).from(verification).where(eq(verification.identifier, identifier));
      const live = counter && counter.expiresAt > new Date() ? Number(counter.value) || 0 : 0;
      if (live >= REAUTH_MAX_FAILURES) throw forbidden(`Too many wrong passwords. Try again in ${REAUTH_LOCK_MINUTES} minutes.`);

      const [credential] = await db
        .select({ password: account.password })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
      const context = await provider.$context;
      const ok = Boolean(credential?.password) && (await context.password.verify({ hash: credential!.password!, password }));

      await db.delete(verification).where(eq(verification.identifier, identifier));
      if (!ok) {
        await db.insert(verification).values({
          id: randomUUID(),
          identifier,
          value: String(live + 1),
          expiresAt: new Date(Date.now() + REAUTH_LOCK_MINUTES * 60_000),
        });
      }
      return ok;
    },

    async verifyTotp(userId, code) {
      const [row] = await db
        .select({ id: twoFactor.id, secret: twoFactor.secret, verified: twoFactor.verified, lockedUntil: twoFactor.lockedUntil })
        .from(twoFactor)
        .where(eq(twoFactor.userId, userId));
      if (!row || row.verified === false) return false;
      if (row.lockedUntil && row.lockedUntil > new Date()) throw forbidden("Two-factor is locked after too many wrong codes. Try again in 15 minutes.");

      const context = await provider.$context;
      const secret = await symmetricDecrypt({ key: context.secretConfig, data: row.secret });
      const key = secret.startsWith(BASE32_PREFIX) ? base32Decode(secret.slice(BASE32_PREFIX.length)) : Buffer.from(secret, "utf8");
      if (totpMatches(key, code)) {
        await db.update(twoFactor).set({ failedVerificationCount: 0, lockedUntil: null }).where(eq(twoFactor.id, row.id));
        return true;
      }
      const [counted] = await db
        .update(twoFactor)
        .set({ failedVerificationCount: sql`coalesce(${twoFactor.failedVerificationCount}, 0) + 1` })
        .where(eq(twoFactor.id, row.id))
        .returning({ failures: twoFactor.failedVerificationCount });
      if ((counted?.failures ?? 0) >= TOTP_MAX_FAILURES) {
        await db.update(twoFactor).set({ lockedUntil: new Date(Date.now() + TOTP_LOCK_MS) }).where(eq(twoFactor.id, row.id));
      }
      return false;
    },
  };
}
