import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { isAPIError } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { account, rateLimit, twoFactor, user } from "../db/schema";
import { forbidden } from "../domain/errors";
import type { Reauth } from "../domain/workspace-deletion";
import { withinRateLimit } from "../rate-limit";
import type { Auth } from "./auth";

/** Password attempts allowed per person in a window before re-authentication locks until the window ends. */
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

/**
 * RFC 6238 (SHA-1, 30-second steps, six digits), as the plugin's own check: this step and one either
 * side. Returns the step the code belongs to, or null. Every candidate is compared, in constant time.
 */
export function totpStep(key: Buffer, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hash = createHmac("sha1", key).update(counter).digest();
    const start = hash[hash.length - 1]! & 0xf;
    const expected = String((hash.readUInt32BE(start) & 0x7fffffff) % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) matched = step;
  }
  return matched;
}

/** `rate_limit` keys this file keeps (Better Auth's own keys are `<address>|<path>`, so they never meet). */
const passwordKey = (userId: string) => `reauth-password:${userId}`;
const totpStepKey = (userId: string) => `reauth-totp-step:${userId}`;

/**
 * Re-authentication for a sensitive change (deleting a workspace), checked on the server against
 * Better Auth's own records: the password hash on the person's credential account, the authenticator
 * secret the two-factor plugin keeps (decrypted with the auth secret), and, for a backup code, the
 * plugin's own `verifyBackupCode`, which uses the code up. That one reads the person's session, so it
 * needs the request's `headers`; without them a backup code is refused.
 *
 * Password attempts are counted before the hash is checked, in one atomic upsert, so attempts made at
 * once cannot get past the limit together. An authenticator code is accepted once: the last accepted
 * step is kept per person, and a code from that step or an earlier one is refused. Wrong codes count
 * toward the plugin's own lockout, which also guards signing in.
 */
export function reauthWith(provider: Auth, db: Db, { headers }: { headers?: Headers } = {}): Reauth {
  const credentialOf = async (userId: string) => {
    const [credential] = await db
      .select({ password: account.password })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
    return credential?.password ?? null;
  };

  return {
    async factors(userId) {
      const [person] = await db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, userId));
      return { password: Boolean(await credentialOf(userId)), twoFactor: Boolean(person?.twoFactorEnabled) };
    },

    async verifyPassword(userId, password) {
      // Counted first: an attempt over the limit is refused without the hash ever being checked.
      if (!(await withinRateLimit(db, passwordKey(userId), { window: REAUTH_LOCK_MINUTES * 60, max: REAUTH_MAX_FAILURES }))) {
        throw forbidden(`Too many password attempts. Try again in ${REAUTH_LOCK_MINUTES} minutes.`);
      }
      const hash = await credentialOf(userId);
      const ok = Boolean(hash) && (await (await provider.$context).password.verify({ hash: hash!, password }));
      if (ok) await db.delete(rateLimit).where(eq(rateLimit.key, passwordKey(userId)));
      return ok;
    },

    async verifySecondFactor(userId, code) {
      const [row] = await db
        .select({ id: twoFactor.id, secret: twoFactor.secret, verified: twoFactor.verified, lockedUntil: twoFactor.lockedUntil })
        .from(twoFactor)
        .where(eq(twoFactor.userId, userId));
      if (!row || row.verified === false) return false;
      if (row.lockedUntil && row.lockedUntil > new Date()) throw forbidden("Two-factor is locked after too many wrong codes. Try again in 15 minutes.");
      // A lock that has run out starts the count afresh, as the plugin does.
      if (row.lockedUntil) await db.update(twoFactor).set({ failedVerificationCount: 0, lockedUntil: null }).where(eq(twoFactor.id, row.id));

      const ok = /^\d{6}$/.test(code) ? await acceptTotp(userId, row.secret, code) : await acceptBackupCode(userId, code);
      if (ok) {
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

  /** The authenticator's code, once: the step it belongs to must be later than the last one accepted. */
  async function acceptTotp(userId: string, encryptedSecret: string, code: string): Promise<boolean> {
    const secret = await symmetricDecrypt({ key: (await provider.$context).secretConfig, data: encryptedSecret });
    const key = secret.startsWith(BASE32_PREFIX) ? base32Decode(secret.slice(BASE32_PREFIX.length)) : Buffer.from(secret, "utf8");
    const step = totpStep(key, code);
    if (step === null) return false;
    // One atomic statement: the row moves forward to this step only if it was before it.
    const moved = await db
      .insert(rateLimit)
      .values({ id: randomUUID(), key: totpStepKey(userId), count: step, lastRequest: Date.now() })
      .onConflictDoUpdate({ target: rateLimit.key, set: { count: sql`excluded.count`, lastRequest: sql`excluded.last_request` }, setWhere: sql`${rateLimit.count} < excluded.count` })
      .returning({ count: rateLimit.count });
    return moved.length === 1;
  }

  /** A backup code, through the two-factor plugin, which checks it and takes it off the person's list. */
  async function acceptBackupCode(userId: string, code: string): Promise<boolean> {
    if (!headers || code.length > 32) return false;
    try {
      const result = await provider.api.verifyBackupCode({ body: { code, disableSession: true }, headers });
      return result?.user?.id === userId;
    } catch (error) {
      if (isAPIError(error)) return false;
      throw error;
    }
  }
}
