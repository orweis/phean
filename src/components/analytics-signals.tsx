"use client";

import { useEffect } from "react";

import { track } from "@/lib/analytics";
import { takeSignals, type AnalyticsSignal } from "@/lib/analytics-signals";

/** Sends what the server signalled (`lib/analytics-signals.ts`), each as its catalog event. */
export function sendSignals(signals: readonly AnalyticsSignal[]): void {
  for (const signal of signals) {
    if (signal.event === "sign_up") track("sign_up", { method: signal.method });
    else if (signal.event === "login") track("login", { method: signal.method, two_factor: false });
    else if (signal.event === "invite_accept") track("invite_accept", { role: signal.role });
    else if (signal.event === "workspace_delete") track("workspace_delete");
    else track("workspace_create");
  }
}

/**
 * On a page people land on after signing up or in, creating a workspace or accepting an invitation:
 * sends the waiting signals once. A tick later, so the loader has applied consent and the page's
 * identity first; reading inside the timer keeps a development double-mount from losing them.
 */
export function AnalyticsSignals() {
  useEffect(() => {
    const timer = window.setTimeout(() => sendSignals(takeSignals()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
