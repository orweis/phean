import type { CSSProperties } from "react";

/**
 * The handoff story's clock (`HandoffRelay`): how long each beat holds, in milliseconds. Beat 0 is
 * the empty stage, the last beat fades everything out again, so the loop ends where it begins.
 * Plain data, shared by the server markup (which beat shows what) and the player (when to move on).
 */
export const HANDOFF_BEATS = [1000, 1800, 1800, 2000, 1600, 1600, 1400, 1200, 1200, 1800, 2200, 1200, 1800, 2400, 900] as const;

/** The beat everything is gone by: the loop's last. */
export const HANDOFF_END = HANDOFF_BEATS.length - 1;

/** The beat the stage rests on without a script: the story's end, the email sent and the task done. */
export const HANDOFF_REST = HANDOFF_END - 1;

export const HANDOFF_LOOP_MS = HANDOFF_BEATS.reduce((sum, ms) => sum + ms, 0);

/** The beat at `elapsed` milliseconds into the loop. */
export function beatAt(elapsed: number): number {
  let left = ((elapsed % HANDOFF_LOOP_MS) + HANDOFF_LOOP_MS) % HANDOFF_LOOP_MS;
  for (const [beat, ms] of HANDOFF_BEATS.entries()) {
    if (left < ms) return beat;
    left -= ms;
  }
  return HANDOFF_END;
}

/**
 * Shown from beat `from` until beat `to` (exclusive): the attributes the stylesheet reads to fade a
 * piece of the stage in and out as the stage's `--beat` moves. `delay` staggers pieces within a beat;
 * `swap` replaces in place instead of rising, for states that take each other's place.
 */
export function shown(from: number, to: number = HANDOFF_END, { delay = 0, swap = false }: { delay?: number; swap?: boolean } = {}) {
  return {
    "data-at": swap ? "swap" : "",
    style: {
      "--in": from,
      "--out": to,
      // A piece that lasts to the end stays through the last beat, wiping away with the rest.
      ...(to === HANDOFF_END && { "--hold": 1 }),
      ...(delay && { transitionDelay: `${delay}ms` }),
    } as CSSProperties,
  };
}
