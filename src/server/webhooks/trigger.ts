import { waitUntil } from "@vercel/functions";

import type { Db } from "../db/client";
import { dispatchDue } from "./dispatch";

/**
 * Wakes the dispatcher right after a change commits, so a webhook fires within moments rather than
 * at the next cron sweep. The work runs after the response is sent (waitUntil keeps a Vercel
 * function alive for it). Kicks that arrive while this instance is already dispatching are folded
 * into one more pass, so a burst of changes costs one or two passes, not one per change.
 */
let running: Promise<void> | null = null;
let again = false;

function runDispatch(db: Db): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await dispatchDue(db);
      } while (again);
    } catch (error) {
      console.error("Phean webhook dispatch failed", error);
    } finally {
      running = null;
    }
  })();
  return running;
}

type Scheduler = (db: Db) => void;

const defaultScheduler: Scheduler = (db) => {
  waitUntil(runDispatch(db));
};

let scheduler: Scheduler = defaultScheduler;

export function scheduleDispatch(db: Db): void {
  scheduler(db);
}

/** Tests replace the scheduler so they can dispatch with a fake fetch, or not at all. */
export function setDispatchScheduler(next: Scheduler | null): void {
  scheduler = next ?? defaultScheduler;
}
