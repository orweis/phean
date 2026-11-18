/** Two-factor settings shared by the server's plugin and the forms that describe them. */

/** "Trust this browser" skips the code on that browser for this many days. */
export const TRUST_DEVICE_DAYS = 30;

/** How long a person has to enter their code after the first factor, in minutes. */
export const TWO_FACTOR_CHALLENGE_MINUTES = 10;

/** Codes are read from the app in groups ("123 456"); the server takes the digits alone. */
export function normalizeCode(value: string): string {
  return value.replace(/\s+/g, "");
}

/** The secret an `otpauth://` URI carries, for people who type it into their app instead of scanning. */
export function totpSecretOf(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

/** A base32 secret in groups of four, which is how authenticator apps ask for it to be typed. */
export function groupSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}
