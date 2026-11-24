"use client";

import { useEffect } from "react";

import { track } from "@/lib/analytics";

const key = (slug: string) => `phean-onboarding:${slug}`;

/**
 * `onboarding_step` `first_task_seen`: the overview shows a task in a workspace this browser saw
 * empty. Remembered in this browser only (the slug never leaves it), so a workspace first opened
 * with tasks already in it sends nothing.
 */
export function FirstTaskSeen({ slug, hasTasks }: { slug: string; hasTasks: boolean }) {
  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(key(slug));
      if (!hasTasks) {
        if (!seen) window.localStorage.setItem(key(slug), "empty");
        return;
      }
      if (seen !== "empty") return;
      window.localStorage.setItem(key(slug), "seen");
      // A tick later, so on a fresh load the analytics loader (an ancestor) has applied consent.
      window.setTimeout(() => track("onboarding_step", { step: "first_task_seen" }), 0);
    } catch {
      // No storage (a private window): nothing to compare with.
    }
  }, [slug, hasTasks]);
  return null;
}
