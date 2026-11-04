"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";

import { pluralize } from "@/lib/format";

import { useStatus } from "./ui/status-region";

/** At most one "what changed" notice a minute, so a busy workspace does not chatter. */
const ANNOUNCE_EVERY_MS = 60_000;
/** A change counts as the refresh's news only this soon after the refresh asked for it. */
const REFRESH_SETTLES_MS = 5_000;

/**
 * Re-renders the current server page on an interval while the tab is visible, so agent work shows
 * up live. The refresh runs in a transition, so open panels, focus and scroll stay where they are.
 * Given `waiting` (requests waiting on a person), it says when new ones arrive, and nothing otherwise.
 */
export function AutoRefresh({ seconds = 15, waiting }: { seconds?: number; waiting?: number }) {
  const router = useRouter();
  const status = useStatus();
  const seen = useRef(waiting);
  const lastSaid = useRef(0);
  const refreshedAt = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshedAt.current = Date.now();
      startTransition(() => router.refresh());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  useEffect(() => {
    if (waiting === undefined) return;
    const before = seen.current ?? waiting;
    seen.current = waiting;
    const arrived = waiting - before;
    // Only news the background refresh brought: a person's own Undo also raises the count, and
    // its notice already says what happened.
    const fromRefresh = Date.now() - refreshedAt.current < REFRESH_SETTLES_MS;
    if (arrived <= 0 || !status || !fromRefresh || status.isShowing() || Date.now() - lastSaid.current < ANNOUNCE_EVERY_MS) return;
    lastSaid.current = Date.now();
    status.announce({ message: `${pluralize(arrived, "new request")} waiting on you.` });
  }, [waiting, status]);

  return null;
}
