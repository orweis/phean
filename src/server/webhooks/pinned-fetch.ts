import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { isPrivateAddress, resolveHost, UnsafeWebhookUrl, type Resolver } from "./url-safety";

/** Statuses whose responses never carry a body; `new Response` refuses one for them. */
const BODYLESS_STATUSES = new Set([101, 204, 205, 304]);

export interface PinnedFetchOptions {
  resolve?: Resolver;
  /** Which resolved addresses to refuse. Tests swap it to reach a local server. */
  isPrivate?: (address: string) => boolean;
}

/**
 * A `fetch` for agent-supplied URLs that cannot be DNS-rebound. It resolves the host once,
 * refuses the request unless every answer is public, and then connects to that same address,
 * keeping the hostname for the Host header, TLS SNI and certificate checks. A plain `fetch`
 * would look the name up again when it connects, after `assertWebhookUrlSafe` had looked,
 * so a short-lived DNS record could point the second answer at a private address.
 *
 * Redirects are never followed (the response is returned as is), like `redirect: "manual"`.
 * It takes what `postSigned` sends: a method, string headers, a string body and a signal.
 */
export function createPinnedFetch({ resolve = resolveHost, isPrivate = isPrivateAddress }: PinnedFetchOptions = {}): typeof fetch {
  const pinnedFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeWebhookUrl("Webhook URLs must use https://.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : await resolve(host).catch(() => {
      throw new UnsafeWebhookUrl(`Could not resolve ${host}.`);
    });
    if (addresses.length === 0 || addresses.some(isPrivate)) throw new UnsafeWebhookUrl(`${host} resolves to a private address.`);
    const address = addresses[0]!;
    const family = isIP(address);
    const lookup: LookupFunction = (_hostname, options, callback) => {
      // With autoSelectFamily Node asks for every answer; give it only the one that was checked.
      if (options.all) (callback as (error: null, addresses: { address: string; family: number }[]) => void)(null, [{ address, family }]);
      else callback(null, address, family);
    };

    const headers = Object.fromEntries(new Headers(init.headers).entries());
    headers.host = url.host;
    const body = init.body == null ? undefined : typeof init.body === "string" ? init.body : undefined;
    if (init.body != null && body === undefined) throw new TypeError("The pinned fetch sends string bodies only.");
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;

    return new Promise<Response>((resolveResponse, reject) => {
      const outgoing = send(
        url,
        {
          agent: false,
          method: init.method ?? "GET",
          headers,
          lookup,
          servername: isIP(host) ? undefined : host,
          signal: init.signal ?? undefined,
        },
        (incoming) => {
          const status = incoming.statusCode ?? 500;
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            for (const item of [value ?? []].flat()) responseHeaders.append(name, item);
          }
          const stream = BODYLESS_STATUSES.has(status) ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
          if (!stream) incoming.resume();
          try {
            resolveResponse(new Response(stream, { status, statusText: incoming.statusMessage, headers: responseHeaders }));
          } catch (error) {
            incoming.destroy();
            reject(error);
          }
        },
      );
      outgoing.once("error", reject);
      outgoing.end(body);
    });
  };
  return pinnedFetch as typeof fetch;
}
