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
