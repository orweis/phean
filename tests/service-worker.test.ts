import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { OFFLINE_CACHE, PUSH_CLIENT_HEADERS } from "@/lib/push";
import { routes } from "@/lib/routes";

import { bundleServiceWorker } from "../scripts/service-worker-bundle";

const ORIGIN = "https://phean.example";
const SW = readFileSync(path.resolve(import.meta.dirname, "../public/sw.js"), "utf8");

const OFFLINE_HTML = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="/_next/static/css/app.css" data-precedence="next"/>
<link rel="preload" href="/_next/static/media/display.woff2" as="font" crossorigin="" type="font/woff2"/>
<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/webpack.js"/>
<link rel="icon" href="/icon.svg"/>
</head><body><h1>You are offline</h1></body></html>`;

const PUSH = {
  v: 1,
  type: "request",
  slug: "acme",
  workspaceName: "Acme",
  requestId: "q_abc123",
  taskId: "t_def456",
  agentName: "Scout",
  kind: "decision",
  question: "Which auditor?",
  options: ["Okafor", "Lindqvist"],
  answerable: true,
};

type Listener = (event: Record<string, unknown>) => void;
type Reply = { status: number; body?: unknown; type?: string; redirected?: boolean };

/** A response as the platform gives it: `type` and `redirected` are read-only on a real one. */
function response({ status, body = "", type = "basic", redirected = false }: Reply): Response {
  // An opaque redirect has status 0, which the constructor refuses.
  const made = new Response(typeof body === "string" ? body : JSON.stringify(body), { status: status || 200 });
  Object.defineProperties(made, { type: { value: type }, redirected: { value: redirected }, status: { value: status }, ok: { value: status >= 200 && status < 300 } });
  return made;
}

/** Runs the committed `public/sw.js` in a sandbox with a fake worker scope, and records what it does. */
function worker(network: (url: string, init?: RequestInit) => Reply | "offline" = () => ({ status: 200, body: "<p>page</p>" }), { endpoint }: { endpoint?: string } = {}) {
  const listeners = new Map<string, Listener>();
  const caches = new Map<string, Map<string, Response>>();
  const fetches: { url: string; init?: RequestInit }[] = [];
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const windows: { url: string; focus: () => Promise<unknown>; navigate: (url: string) => Promise<unknown> }[] = [];
  let skipped = false;

  const scope: Record<string, unknown> = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => void (skipped = true),
    fetch: async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      fetches.push({ url, init });
      const reply = network(url, init);
      if (reply === "offline") throw new TypeError("Failed to fetch");
      return response(reply);
    },
    caches: {
      open: async (name: string) => {
        const cache = caches.get(name) ?? new Map<string, Response>();
        caches.set(name, cache);
        return { put: async (key: string, value: Response) => void cache.set(key, value), match: async (key: string) => cache.get(key) };
      },
      keys: async () => [...caches.keys()],
      delete: async (name: string) => caches.delete(name),
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options: JSON.parse(JSON.stringify(options)) }),
      getNotifications: async ({ tag }: { tag: string }) => shown.filter((item) => item.options.tag === tag).slice(-1).map((item) => ({ data: item.options.data, close() {} })),
      ...(endpoint && { pushManager: { getSubscription: async () => ({ endpoint }) } }),
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => void opened.push(url),
      claim: async () => {},
    },
    Response,
    URL,
    URLSearchParams,
  };
  scope.self = scope;
  vm.runInNewContext(SW, scope);

  /** Dispatches an event and waits for everything it handed to waitUntil and respondWith. */
  async function dispatch(type: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => waits.push(promise), respondWith: (promise: Promise<Response>) => (responded = promise) });
    await Promise.all(waits);
    return responded ? await responded : undefined;
  }

  const push = (payload: unknown) => dispatch("push", { data: { text: () => JSON.stringify(payload) } });
  const click = (data: unknown, action = "") => dispatch("notificationclick", { action, notification: { data, close() {} } });
  const openWindow = (url: string) => windows.push({ url, focus: async () => windows.at(-1), navigate: async (to: string) => void navigated.push(to) });

  return { listeners, caches, fetches, shown, opened, navigated, dispatch, push, click, openWindow, skipped: () => skipped };
}

const navigation = (url: string, method = "GET") => ({ request: { url: `${ORIGIN}${url}`, mode: "navigate", method } });

describe("public/sw.js", () => {
  it("is in step with src/lib/service-worker.ts and src/lib/push.ts (run `pnpm sw`)", () => {
    expect(SW).toBe(bundleServiceWorker());
  });

  it("listens for exactly the events it handles", () => {
    expect([...worker().listeners.keys()].sort()).toEqual(["activate", "fetch", "install", "notificationclick", "notificationclose", "push"]);
  });

  it("precaches only /offline and its static files, fetched without cookies", async () => {
    const sw = worker((url) => (url === routes.offline() ? { status: 200, body: OFFLINE_HTML } : { status: 200, body: "asset" }));
    await sw.dispatch("install");
    expect([...sw.caches.keys()]).toEqual([OFFLINE_CACHE]);
    expect([...sw.caches.get(OFFLINE_CACHE)!.keys()].sort()).toEqual(["/_next/static/css/app.css", "/_next/static/media/display.woff2", routes.offline()].sort());
    expect(sw.fetches.find((call) => call.url === routes.offline())?.init).toMatchObject({ credentials: "omit" });
    expect(sw.skipped()).toBe(true);
  });

  it("refuses to install over a redirected or failed offline page", async () => {
    const redirected = worker(() => ({ status: 200, body: OFFLINE_HTML, redirected: true }));
    await expect(redirected.dispatch("install")).rejects.toThrow();
    expect(redirected.caches.get(OFFLINE_CACHE)?.size ?? 0).toBe(0);
    await expect(worker(() => ({ status: 500 })).dispatch("install")).rejects.toThrow();
  });

  it("drops caches it does not own when it activates", async () => {
    const sw = worker();
    sw.caches.set("old-cache", new Map());
    await sw.dispatch("activate");
    expect([...sw.caches.keys()]).not.toContain("old-cache");
  });

  it("serves page loads from the network and caches nothing", async () => {
    const sw = worker((url) => (url === routes.offline() ? { status: 200, body: OFFLINE_HTML } : { status: 200, body: "<p>the board</p>" }));
    await sw.dispatch("install");
    const before = [...sw.caches.get(OFFLINE_CACHE)!.keys()];
    const page = await sw.dispatch("fetch", navigation("/w/acme/board"));
    expect(await page!.text()).toBe("<p>the board</p>");
    expect([...sw.caches.get(OFFLINE_CACHE)!.keys()]).toEqual(before);
  });

  it("passes redirects through untouched", async () => {
    const sw = worker(() => ({ status: 0, type: "opaqueredirect" }));
    const page = await sw.dispatch("fetch", navigation("/w/acme"));
    expect(page!.type).toBe("opaqueredirect");
    expect(sw.caches.get(OFFLINE_CACHE)?.size ?? 0).toBe(0);
  });

  it("shows /offline when a page load cannot reach the network", async () => {
    let online = true;
    const sw = worker((url) => (!online ? "offline" : url === routes.offline() ? { status: 200, body: OFFLINE_HTML } : { status: 200 }));
    await sw.dispatch("install");
    online = false;
    const page = await sw.dispatch("fetch", navigation("/w/acme/decisions"));
    expect(await page!.text()).toBe(OFFLINE_HTML);
  });

  it("leaves everything but GET page loads to the browser", async () => {
    const sw = worker();
    expect(await sw.dispatch("fetch", { request: { url: `${ORIGIN}/w/acme/board?_rsc=1`, mode: "cors", method: "GET" } })).toBeUndefined();
    expect(await sw.dispatch("fetch", navigation("/oauth/approve", "POST"))).toBeUndefined();
    expect(await sw.dispatch("fetch", { request: { url: `${ORIGIN}/_next/static/css/app.css`, mode: "no-cors", method: "GET" } })).toBeUndefined();
    expect(sw.fetches).toEqual([]);
  });

  it("shows a request push with its tag, question and option buttons", async () => {
    const sw = worker();
    await sw.push(PUSH);
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]).toMatchObject({
      title: "Scout asks · Acme",
      options: { tag: "q_abc123", body: "Which auditor?", actions: [{ action: "option-0", title: "Okafor" }, { action: "option-1", title: "Lindqvist" }] },
    });
  });

  it("shows a private push without its question, and a resolved push over the same tag", async () => {
    const sw = worker();
    await sw.push({ v: 1, type: "request", private: true, slug: "acme", workspaceName: "Acme", requestId: "q_abc123", taskId: "t_def456" });
    expect(sw.shown[0]).toMatchObject({ title: "A decision is waiting in Acme", options: { tag: "q_abc123", actions: [] } });
    await sw.push(PUSH);
    await sw.push({ v: 1, type: "resolved", slug: "acme", requestId: "q_abc123", by: "Dana" });
    expect(sw.shown.at(-1)).toMatchObject({ title: "Answered by Dana", options: { tag: "q_abc123", body: "Which auditor?", actions: [] } });
  });

  it("opens the request from a click, built from the ids, never from a URL in the payload", async () => {
    const sw = worker();
    await sw.push({ ...PUSH, url: "https://evil.example/" });
    await sw.click(sw.shown[0]!.options.data);
    expect(sw.opened).toEqual([`${ORIGIN}${routes.request("acme", "q_abc123")}`]);
  });

  it("focuses an open Phean window rather than opening another, and ignores other origins", async () => {
    const sw = worker();
    sw.openWindow("https://evil.example/");
    sw.openWindow(`${ORIGIN}/w/acme/board`);
    await sw.push(PUSH);
    await sw.click(sw.shown[0]!.options.data);
    expect(sw.navigated).toEqual([`${ORIGIN}${routes.request("acme", "q_abc123")}`]);
    expect(sw.opened).toEqual([]);
  });

  it("answers from an option button with the index, and offers Undo", async () => {
    const sw = worker((url) => (url === routes.pushAnswer("acme") ? { status: 200, body: { answer: "Lindqvist", taskTitle: "Pick the auditor", agentName: "Scout" } } : { status: 404 }));
    await sw.push(PUSH);
    await sw.click(sw.shown[0]!.options.data, "option-1");
    const call = sw.fetches.find((item) => item.url === routes.pushAnswer("acme"))!;
    expect(call.init).toMatchObject({ method: "POST", headers: PUSH_CLIENT_HEADERS, credentials: "same-origin" });
    expect(JSON.parse(call.init!.body as string)).toEqual({ taskId: "t_def456", requestId: "q_abc123", option: 1 });
    expect(sw.shown.at(-1)).toMatchObject({ title: "Sent “Lindqvist” to Scout", options: { tag: "q_abc123", actions: [{ action: "undo", title: "Undo" }] } });
    expect(sw.opened).toEqual([]);
  });

  it("names its own device by its push endpoint when it answers and undoes", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/this-phone";
    const sw = worker(
      (url) => (url === routes.pushAnswer("acme") ? { status: 200, body: { answer: "Okafor", taskTitle: "Pick the auditor", agentName: "Scout" } } : { status: 200, body: {} }),
      { endpoint },
    );
    await sw.push(PUSH);
    await sw.click(sw.shown[0]!.options.data, "option-0");
    await sw.click(sw.shown.at(-1)!.options.data, "undo");
    const body = (path: string) => JSON.parse(sw.fetches.find((item) => item.url === path)!.init!.body as string);
    expect(body(routes.pushAnswer("acme"))).toEqual({ taskId: "t_def456", requestId: "q_abc123", option: 0, endpoint });
    expect(body(routes.pushUndo("acme"))).toEqual({ taskId: "t_def456", requestId: "q_abc123", endpoint });
  });

  it("says so when the request was already answered", async () => {

    const sw = worker(() => ({ status: 409, body: { error: "stale", message: "Dana answered this first." } }));
    await sw.push(PUSH);
    await sw.click(sw.shown[0]!.options.data, "option-0");
    expect(sw.shown.at(-1)).toMatchObject({ title: "Already answered", options: { body: "Dana answered this first.", actions: [] } });
  });

  it("takes an answer back with Undo, and shows the request again", async () => {
    const sw = worker((url) =>
      url === routes.pushAnswer("acme") ? { status: 200, body: { answer: "Okafor", taskTitle: "Pick the auditor", agentName: "Scout" } } : url === routes.pushUndo("acme") ? { status: 200, body: {} } : { status: 404 },
    );
    await sw.push(PUSH);
    await sw.click(sw.shown[0]!.options.data, "option-0");
    await sw.click(sw.shown.at(-1)!.options.data, "undo");
    const call = sw.fetches.find((item) => item.url === routes.pushUndo("acme"))!;
    expect(call.init).toMatchObject({ method: "POST", headers: PUSH_CLIENT_HEADERS });
    expect(JSON.parse(call.init!.body as string)).toEqual({ taskId: "t_def456", requestId: "q_abc123" });
    expect(sw.shown.at(-1)).toMatchObject({ title: "Scout asks · Acme", options: { actions: [{ title: "Okafor" }, { title: "Lindqvist" }] } });
  });

  it("does nothing when a notification is dismissed", async () => {
    const sw = worker();
    await sw.push(PUSH);
    await sw.dispatch("notificationclose", { notification: { data: sw.shown[0]!.options.data } });
    expect(sw.fetches).toEqual([]);
    expect(sw.opened).toEqual([]);
  });
});
