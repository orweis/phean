import { randomBytes } from "node:crypto";

// Crockford base32, lowercase: unambiguous when read aloud or copied by an agent.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

export type IdPrefix = "g" | "t" | "m" | "ag";

export function newId(prefix: IdPrefix): string {
  let suffix = "";
  for (const byte of randomBytes(12)) suffix += ALPHABET[byte & 31];
  return `${prefix}_${suffix}`;
}
