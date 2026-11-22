"use client";

import { useEffect } from "react";

import { tieDeviceAction } from "@/app/account/actions";
import { routes } from "@/lib/routes";

import { browserPushSubscription } from "./push-subscription";

/**
 * Registers the service worker (`public/sw.js`) for the whole origin, once the page has loaded. It
 * renders nothing. The desktop app has its own offline page and notifications, so it is skipped
 * there, and a browser without service workers simply goes without.
 *
 * When this browser has notifications on, it also ties its device to the session it is signed in
 * with now, so a device whose session expired or was replaced still ends when this browser signs
 * out. The server ignores it without a session, or for someone else's device.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || "pheanDesktop" in window) return;
    navigator.serviceWorker
      .register(routes.serviceWorker(), { scope: routes.home(), updateViaCache: "none" })
      .then(async () => {
        const subscription = await browserPushSubscription();
        if (subscription) await tieDeviceAction(subscription.endpoint);
      })
      .catch(() => {
        // Without a worker Phean still works: it only loses the offline page and notifications.
      });
  }, []);
  return null;
}
