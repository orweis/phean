import { registerDeviceAction } from "@/app/account/actions";
import { deviceLabel } from "@/lib/device-label";

/**
 * This browser's push subscription, if Phean's service worker has one: how the page names its own
 * notification device to the server. Null without a worker, without the Push API, or in the desktop
 * app (which has no device of this kind). Never waits for a worker that is not registered.
 */
export async function browserPushSubscription(): Promise<PushSubscription | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || "pheanDesktop" in window) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** The VAPID key as the Push API takes it. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/** The service worker's registration, if the page has one; `ready` alone would wait forever without it. */
export async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!(await navigator.serviceWorker.getRegistration())) return null;
  return navigator.serviceWorker.ready;
}

export type SubscribeResult =
  | { ok: true; deviceId: string; label: string; endpoint: string }
  /** Phean's service worker is not registered on this page yet. */
  | { ok: false; reason: "no-worker" }
  | { ok: false; reason: "message"; message: string };

/**
 * Turns on notifications for this browser: asks for permission, subscribes with the server's key
 * (replacing a subscription made for another key), and registers the device. The Account page and
 * the Decisions page's prompt both turn notifications on through this.
 */
export async function subscribeThisDevice(publicKey: string): Promise<SubscribeResult> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        ok: false,
        reason: "message",
        message:
          permission === "denied"
            ? "Notifications are blocked for Phean in this browser's settings. Allow them there, then try again."
            : "Allow notifications when your browser asks, to get them here.",
      };
    }
    const ready = await pushRegistration();
    if (!ready) return { ok: false, reason: "no-worker" };
    const key = keyBytes(publicKey);
    let current = await ready.pushManager.getSubscription();
    // A subscription made for another key (the server's keys changed) can never be written to.
    if (current && !sameKey(current, key)) {
      await current.unsubscribe();
      current = null;
    }
    current ??= await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const result = await registerDeviceAction({ ...current.toJSON(), label: deviceLabel(navigator.userAgent) });
    if (!result.ok) return { ok: false, reason: "message", message: result.message };
    return { ok: true, deviceId: result.deviceId, label: result.label, endpoint: current.endpoint };
  } catch {
    return { ok: false, reason: "message", message: "This browser could not subscribe to notifications. Try again, or use another browser." };
  }
}
