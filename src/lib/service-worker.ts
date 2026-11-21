import {
  answerCall,
  answeredNotification,
  answerFailedNotification,
  isOfflineAsset,
  isPageNavigation,
  isSameOrigin,
  notificationFor,
  notificationUrl,
  OFFLINE_CACHE,
  offlineAssets,
  optionIndexOf,
  parseAnswerResult,
  parsePushPayload,
  PUSH_CLIENT_HEADERS,
  readNotificationData,
  UNDO_ACTION,
  undoCall,
  undoFailedNotification,
  undoneNotification,
  type NotificationData,
  type NotificationSpec,
  type PushCall,
} from "./push";
import { routes } from "./routes";

/**
 * The service worker's event wiring, bundled with `lib/push.ts` into `public/sw.js` by
 * `scripts/service-worker.ts`. It handles page navigations only (network first, the precached
 * `/offline` when the network fails), never caches a response or a redirect, and shows and answers
 * Web Push notifications. The types below are the slice of the worker's global scope it uses, so
 * this file needs no `webworker` lib and the tests can run it against fakes.
 */

interface ExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  request: Request;
  preloadResponse?: Promise<Response | undefined>;
  respondWith(response: Promise<Response>): void;
}

interface PushEvent extends ExtendableEvent {
  data: { text(): string } | null;
}

interface ShownNotification {
  data: unknown;
  close(): void;
}

interface NotificationEvent extends ExtendableEvent {
  action: string;
  notification: ShownNotification;
}

interface WindowClient {
  url: string;
  focus(): Promise<WindowClient>;
  navigate(url: string): Promise<WindowClient | null>;
}

interface WorkerCache {
  put(request: string, response: Response): Promise<void>;
  match(request: string): Promise<Response | undefined>;
}

export interface WorkerScope {
  location: { origin: string };
  registration: {
    showNotification(title: string, options: NotificationSpec["options"]): Promise<void>;
    getNotifications(filter: { tag: string }): Promise<ShownNotification[]>;
    navigationPreload?: { enable(): Promise<void> };
  };
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<WindowClient[]>;
    openWindow(url: string): Promise<WindowClient | null>;
    claim(): Promise<void>;
  };
  caches: {
    open(name: string): Promise<WorkerCache>;
    keys(): Promise<string[]>;
    delete(name: string): Promise<boolean>;
  };
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  addEventListener(type: "push", listener: (event: PushEvent) => void): void;
  addEventListener(type: "notificationclick" | "notificationclose", listener: (event: NotificationEvent) => void): void;
}

/** A response the cache may keep: a plain same-origin 200 that was not redirected. */
const keepable = (response: Response) => response.ok && response.status === 200 && !response.redirected && response.type === "basic";

export function installServiceWorker(scope: WorkerScope): void {
  const offline = routes.offline();

  /** The offline page and its static files, fetched without cookies so no session data is ever kept. */
  async function precache() {
    const cache = await scope.caches.open(OFFLINE_CACHE);
    const page = await scope.fetch(offline, { credentials: "omit", cache: "reload" });
    if (!keepable(page)) throw new Error("The offline page could not be fetched");
    const html = await page.clone().text();
    await cache.put(offline, page);
    await Promise.all(
      offlineAssets(html).map(async (asset) => {
        const response = await scope.fetch(asset, { credentials: "omit" }).catch(() => null);
        if (response && keepable(response) && isOfflineAsset(asset)) await cache.put(asset, response);
      }),
    );
  }

  async function show(spec: NotificationSpec) {
    await scope.registration.showNotification(spec.title, spec.options);
  }

  /** Focuses a window of this origin on the request, or opens one. */
  async function open(data: NotificationData | null) {
    const url = notificationUrl(data, scope.location.origin);
    const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => isSameOrigin(client.url, scope.location.origin));
    if (existing) {
      try {
        const focused = await existing.focus();
        await focused.navigate(url);
        return;
      } catch {
        // A window this worker does not control cannot be navigated; open a new one instead.
      }
    }
    await scope.clients.openWindow(url);
  }

  async function post(call: PushCall): Promise<{ status: number; body: unknown }> {
    const response = await scope.fetch(call.path, { method: "POST", headers: PUSH_CLIENT_HEADERS, body: JSON.stringify(call.body), credentials: "same-origin" });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  }

  const messageOf = (body: unknown) =>
    typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" ? body.message : undefined;

  async function answer(data: NotificationData, option: number) {
    const call = answerCall(data, option);
    if (!call) return open(data);
    const reply = await post(call).catch(() => ({ status: 0, body: null }));
    const result = reply.status === 200 ? parseAnswerResult(reply.body) : null;
    await show(result ? answeredNotification(data, result) : answerFailedNotification(data, reply.status, messageOf(reply.body)));
  }

  async function undo(data: NotificationData) {
    const call = undoCall(data);
    if (!call) return open(data);
    const reply = await post(call).catch(() => ({ status: 0, body: null }));
    await show(reply.status === 200 ? undoneNotification(data) : undoFailedNotification(data, reply.status));
  }

  scope.addEventListener("install", (event) => {
    event.waitUntil(precache().then(() => scope.skipWaiting()));
  });

  scope.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        for (const name of await scope.caches.keys()) if (name !== OFFLINE_CACHE) await scope.caches.delete(name);
        await scope.registration.navigationPreload?.enable();
        await scope.clients.claim();
      })(),
    );
  });

  scope.addEventListener("fetch", (event) => {
    if (!isPageNavigation(event.request)) return;
    event.respondWith(
      (async () => {
        try {
          // The page as the network gives it, redirects included; nothing here is ever stored.
          return (await event.preloadResponse) ?? (await scope.fetch(event.request));
        } catch {
          const cached = await (await scope.caches.open(OFFLINE_CACHE)).match(offline);
          return cached ?? Response.error();
        }
      })(),
    );
  });

  scope.addEventListener("push", (event) => {
    event.waitUntil(
      (async () => {
        const push = parsePushPayload(event.data?.text());
        const previous = push?.type === "resolved" ? readNotificationData((await scope.registration.getNotifications({ tag: push.requestId }))[0]?.data) : null;
        await show(notificationFor(push, previous));
      })(),
    );
  });

  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const data = readNotificationData(event.notification.data);
    const option = optionIndexOf(event.action);
    event.waitUntil(data && event.action === UNDO_ACTION ? undo(data) : data && option !== null ? answer(data, option) : open(data));
  });

  // Dismissing a notification answers nothing and calls nothing: the request stays open on the Decisions page.
  scope.addEventListener("notificationclose", () => {});
}
