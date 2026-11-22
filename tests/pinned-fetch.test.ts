import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postSigned } from "@/server/webhooks/dispatch";
import { createPinnedFetch } from "@/server/webhooks/pinned-fetch";
import { isPrivateAddress } from "@/server/webhooks/url-safety";

interface Seen {
  method: string;
  url: string;
  host: string | undefined;
  body: string;
}

let server: Server;
let port: number;
const seen: Seen[] = [];

function handle(request: IncomingMessage, response: ServerResponse) {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => (body += chunk));
  request.on("end", () => {
    seen.push({ method: request.method!, url: request.url!, host: request.headers.host, body });
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
    } else if (request.url === "/slow") {
      setTimeout(() => response.writeHead(200).end("late"), 2_000).unref();
    } else if (request.url === "/empty") {
      response.writeHead(204).end();
    } else {
      response.writeHead(202, { "content-type": "text/plain", "x-multi": ["a", "b"] }).end("accepted");
    }
  });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** A resolver that answers from a script, one answer per call, and counts the calls. */
function scripted(...answers: string[][]) {
  const calls: string[] = [];
  const resolve = async (hostname: string) => {
    calls.push(hostname);
    return answers[Math.min(calls.length - 1, answers.length - 1)]!;
  };
  return { resolve, calls };
}

// The local test server lives on loopback, so these tests allow it explicitly.
const allowLoopback = (address: string) => address !== "127.0.0.1" && isPrivateAddress(address);

describe("pinned fetch", () => {
  it("connects to the checked address while keeping the hostname for the Host header", async () => {
    const dns = scripted(["127.0.0.1"]);
    const pinned = createPinnedFetch({ resolve: dns.resolve, isPrivate: allowLoopback });
    // No real DNS knows this name, so reaching the server proves the connection was pinned.
    const response = await pinned(`http://hooks.phean-test.invalid:${port}/hook?x=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "k" },
      body: '{"hello":"world"}',
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("accepted");
    expect(response.headers.get("x-multi")).toBe("a, b");
    expect(dns.calls).toEqual(["hooks.phean-test.invalid"]);
    expect(seen.at(-1)).toEqual({ method: "POST", url: "/hook?x=1", host: `hooks.phean-test.invalid:${port}`, body: '{"hello":"world"}' });
  });

  it("refuses before connecting when any answer is private", async () => {
    const before = seen.length;
    for (const answers of [["10.0.0.7"], ["93.184.216.34", "169.254.169.254"], ["::1"], []]) {
      const pinned = createPinnedFetch({ resolve: scripted(answers).resolve });
      await expect(pinned(`http://hooks.phean-test.invalid:${port}/hook`, { method: "POST", body: "{}" }), answers.join()).rejects.toThrow(/private/);
    }
    await expect(createPinnedFetch({ resolve: async () => Promise.reject(new Error("NXDOMAIN")) })("https://nowhere.invalid/")).rejects.toThrow(/Could not resolve/);
    expect(seen.length).toBe(before);
  });

  it("does not follow redirects", async () => {
    const pinned = createPinnedFetch({ resolve: scripted(["127.0.0.1"]).resolve, isPrivate: allowLoopback });
    const response = await pinned(`http://hooks.phean-test.invalid:${port}/redirect`, { method: "POST", body: "{}" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("169.254.169.254");
  });

  it("handles bodiless responses and honours the abort signal", async () => {
    const pinned = createPinnedFetch({ resolve: scripted(["127.0.0.1"]).resolve, isPrivate: allowLoopback });
    expect((await pinned(`http://hooks.phean-test.invalid:${port}/empty`, { method: "POST", body: "{}" })).status).toBe(204);
    await expect(pinned(`http://hooks.phean-test.invalid:${port}/slow`, { method: "POST", body: "{}", signal: AbortSignal.timeout(100) })).rejects.toThrow();
  });

  it("rejects schemes other than http and https", async () => {
    await expect(createPinnedFetch()("file:///etc/passwd")).rejects.toThrow(/https/);
  });
});

describe("DNS rebinding", () => {
  it("keeps a webhook whose name turns private after the check from reaching the private address", async () => {
    // First answer (the check in postSigned) is public; the second (the connect) is metadata.
    const dns = scripted(["93.184.216.34"], ["169.254.169.254"]);
    const result = await postSigned(
      "https://rebind.phean-test.invalid/hook",
      "whsec_test",
      "{}",
      { webhookId: "wh_test", deliveryId: "dl_test" },
      { fetch: createPinnedFetch({ resolve: dns.resolve }), resolve: dns.resolve, allowPrivate: false },
    );
    expect(result).toMatchObject({ ok: false, status: null });
    expect(result.error).toMatch(/private/);
    expect(dns.calls).toHaveLength(2);
  });
});

describe("private address ranges", () => {
  it("treats IPv6 forms that can carry a private IPv4 address as private", () => {
    for (const address of ["::a00:1", "::10.0.0.1", "::", "::1", "2002:a00:1::1", "2001:0:4136:e378::1", "2001::1", "64:ff9b::a00:1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["2001:470:1::1", "2001:4860:4860::8888", "2606:4700::1111", "2a00:1450:4001::1"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});
