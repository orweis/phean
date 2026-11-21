"use client";

import { useEffect } from "react";

import { routes } from "@/lib/routes";

/**
 * Registers the service worker (`public/sw.js`) for the whole origin, once the page has loaded. It
 * renders nothing. The desktop app has its own offline page and notifications, so it is skipped
 * there, and a browser without service workers simply goes without.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || "pheanDesktop" in window) return;
    navigator.serviceWorker.register(routes.serviceWorker(), { scope: routes.home(), updateViaCache: "none" }).catch(() => {
      // Without a worker Phean still works: it only loses the offline page and notifications.
    });
  }, []);
  return null;
}
