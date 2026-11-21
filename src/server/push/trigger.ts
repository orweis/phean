import { waitUntil } from "@vercel/functions";

import type { Db } from "../db/client";
import { sendDuePushes } from "./dispatch";

/**
 * Wakes the push sender right after a change commits, like `scheduleDispatch` for webhooks: the
 * work runs after the response is sent, and kicks that arrive while this instance is already
 * sending are folded into one more pass.
 */
let running: Promise<void> | null = null;
let again = false;

function runSend(db: Db): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await sendDuePushes(db);
      } while (again);
    } catch (error) {
      // Never the payload: only that the pass failed.
      console.error("Phean push dispatch failed", error instanceof Error ? error.name : "error");
    } finally {
      running = null;
    }
  })();
  return running;
}

type Scheduler = (db: Db) => void;

const defaultScheduler: Scheduler = (db) => {
  waitUntil(runSend(db));
};

let scheduler: Scheduler = defaultScheduler;

export function schedulePushes(db: Db): void {
  scheduler(db);
}

/** Tests replace the scheduler so they can send with a fake push service, or not at all. */
export function setPushScheduler(next: Scheduler | null): void {
  scheduler = next ?? defaultScheduler;
}
