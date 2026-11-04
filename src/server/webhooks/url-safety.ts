import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Webhook URLs come from agents, and Phean's servers call them, so a URL must not reach
 * anything private: loopback, the cloud metadata endpoint, or the internal network. The check
 * runs when a webhook is registered and again before every send, because DNS can change.
 * (A name that resolves differently between the check and the connect can still slip through;
 * redirects are never followed, which closes the easier route.)
 */

/** Development and the UI tests deliver to a local receiver; production never sets this. */
export const allowPrivateWebhooks = () => process.env.PHEAN_WEBHOOK_ALLOW_PRIVATE === "1";

const PRIVATE_V4: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8 "this network"
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10 carrier-grade NAT
  [0x7f000000, 8], // 127.0.0.0/8 loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local, cloud metadata
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24 IETF protocol assignments
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15 benchmarking
  [0xe0000000, 3], // 224.0.0.0/3 multicast and reserved
];

function v4ToInt(address: string): number {
  return address.split(".").reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function isPrivateV4(address: string): boolean {
  const value = v4ToInt(address);
  return PRIVATE_V4.some(([base, bits]) => (value & (bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0)) >>> 0 === base);
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateV4(address);
  if (family !== 6) return true;
  const lower = address.toLowerCase();
  // IPv4-mapped addresses, dotted (::ffff:10.0.0.1) or as URL parsing writes them (::ffff:a00:1).
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateV4(mapped[1]!);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (mappedHex) {
    const [high, low] = [parseInt(mappedHex[1]!, 16), parseInt(mappedHex[2]!, 16)];
    return isPrivateV4([high >> 8, high & 255, low >> 8, low & 255].join("."));
  }
  return (
    lower === "::" ||
    lower === "::1" ||
    /^f[cd]/.test(lower) || // fc00::/7 unique local
    /^fe[89ab]/.test(lower) || // fe80::/10 link-local
    /^ff/.test(lower) || // multicast
    lower.startsWith("64:ff9b:") // NAT64 can reach IPv4 private space
  );
}

export class UnsafeWebhookUrl extends Error {}

/** Checks the URL's shape: https (http only for local development), no credentials, a public host. */
export function assertWebhookUrlShape(value: string, allowPrivate = allowPrivateWebhooks()): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeWebhookUrl("Not a valid URL.");
  }
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) {
    throw new UnsafeWebhookUrl("Webhook URLs must use https://.");
  }
  if (url.username || url.password) throw new UnsafeWebhookUrl("Put credentials in your endpoint's own auth, not in the URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
      throw new UnsafeWebhookUrl("Webhook URLs must point at a public host.");
    }
    if (isIP(host) && isPrivateAddress(host)) throw new UnsafeWebhookUrl("Webhook URLs must point at a public address.");
  }
  return url;
}

export type Resolver = (hostname: string) => Promise<string[]>;

export const resolveHost: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/** The shape check plus DNS: every address the host resolves to must be public. */
export async function assertWebhookUrlSafe(value: string, { allowPrivate = allowPrivateWebhooks(), resolve = resolveHost } = {}): Promise<URL> {
  const url = assertWebhookUrlShape(value, allowPrivate);
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => {
    throw new UnsafeWebhookUrl(`Could not resolve ${host}.`);
  });
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeWebhookUrl(`${host} resolves to a private address.`);
  }
  return url;
}
