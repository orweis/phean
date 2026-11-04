import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Webhook signatures, and the encryption of the secrets they are made with.
 *
 * Each request carries `Phean-Signature: t=<unix seconds>,v1=<hex>`, where v1 is
 * HMAC-SHA256(secret, `${t}.${body}`). Receivers recompute it, compare in constant time, and
 * reject timestamps older than a few minutes so a captured request cannot be replayed later.
 */

export const SIGNATURE_HEADER = "Phean-Signature";
export const SECRET_PREFIX = "whsec_";

export function newWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** What a receiver does; used by the tests and shown in the docs. */
export function verifySignature(secret: string, body: string, header: string, { toleranceSeconds = 300, now = Date.now() } = {}): boolean {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1 || Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(signPayload(secret, body, timestamp).split("v1=")[1]!, "hex");
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The key that encrypts stored secrets. PHEAN_WEBHOOK_KEY if set; otherwise derived from
 * BETTER_AUTH_SECRET, which every deployment already has. Rotating either makes stored secrets
 * unreadable, so agents re-register their webhooks.
 */
function encryptionKey(): Buffer {
  const material = process.env.PHEAN_WEBHOOK_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!material && process.env.NODE_ENV === "production") throw new Error("Set PHEAN_WEBHOOK_KEY or BETTER_AUTH_SECRET to store webhook secrets.");
  const secret = material ?? "phean-development-only-webhook-key";
  return Buffer.from(hkdfSync("sha256", secret, createHash("sha256").update("phean").digest(), "phean webhook secrets v1", 32));
}

/** AES-256-GCM, stored as `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unreadable webhook secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
