import { assertWebhookUrlSafe, resolveHost, UnsafeWebhookUrl, type Resolver } from "../webhooks/url-safety";

/**
 * The push services browsers subscribe through: Chrome and Android (FCM), Firefox (Mozilla's
 * autopush), Safari (Apple) and Edge (Windows Push Notification Services). A device's endpoint must
 * be one of them, so Phean never posts to an address a page chose. A leading dot means any
 * subdomain; otherwise the host must match exactly.
 */
export const PUSH_HOST_SUFFIXES = ["fcm.googleapis.com", ".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"] as const;

export class UnsafePushEndpoint extends Error {}

export function isPushServiceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => (suffix.startsWith(".") ? host.endsWith(suffix) && host.length > suffix.length : host === suffix));
}

/** The shape alone: https, no credentials or port, on a push service's host. */
export function assertPushEndpointShape(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafePushEndpoint("Not a valid push endpoint.");
  }
  if (url.protocol !== "https:") throw new UnsafePushEndpoint("Push endpoints use https://.");
  if (url.username || url.password || url.port) throw new UnsafePushEndpoint("That is not a push service's address.");
  if (!isPushServiceHost(url.hostname)) throw new UnsafePushEndpoint("Phean sends notifications through the browsers' push services only.");
  return url;
}

/**
 * The shape check plus the webhooks' private-address check: every address the host resolves to
 * must be public. Run when a device registers and again before every send, because DNS changes.
 * This replaces `postSigned`'s checks for push (AGENTS.md records the exception).
 */
export async function assertPushEndpointSafe(value: string, { resolve = resolveHost }: { resolve?: Resolver } = {}): Promise<URL> {
  const url = assertPushEndpointShape(value);
  try {
    await assertWebhookUrlSafe(url.href, { allowPrivate: false, resolve });
  } catch (error) {
    if (error instanceof UnsafeWebhookUrl) throw new UnsafePushEndpoint(error.message);
    throw error;
  }
  return url;
}
