import type { CSSProperties } from "react";

/**
 * The handoff story's clock (`HandoffRelay`): how long each beat holds, in milliseconds. Beat 0 is
 * the empty stage, the last beat wipes everything away again, so the loop ends where it begins.
 * Plain data, shared by the server markup (which beat shows what) and the player (when to move on).
 *
 *  0 empty · 1 you ask Grok Bot · 2 it drafts · 3 it hands off in Phean · 4 the routine fires ·
 *  5 Claude claims · 6–7 researches · 8 updates the draft · 9 hands it back · 10 Phean shows it back ·
 *  11 Grok Bot hears · 12 reviews · 13 sends · 14 completes, in Phean · 15 the loop's end
 */
// About 32 seconds: the moments to read (a message, a note, a result) hold longer than the steps between them.
export const HANDOFF_BEATS = [1000, 2400, 2400, 2800, 2500, 1600, 1500, 1300, 2200, 2200, 2500, 1500, 2500, 2000, 3000, 1000] as const;

/** The beat everything is gone by: the loop's last. */
export const HANDOFF_END = HANDOFF_BEATS.length - 1;

/** The beat the stage rests on without a script: the story's end, the email sent and the task done. */
export const HANDOFF_REST = HANDOFF_END - 1;

export const HANDOFF_LOOP_MS = HANDOFF_BEATS.reduce((sum, ms) => sum + ms, 0);

/** The three apps on the stage. */
export type HandoffWindow = "grok" | "claude" | "phean";

/** The window whose part of the story is playing at each beat: it comes to the front. */
export const HANDOFF_FRONT: readonly HandoffWindow[] = [
  "grok",
  "grok",
  "grok",
  "phean",
  "claude",
  "claude",
  "claude",
  "claude",
  "claude",
  "claude",
  "phean",
  "grok",
  "grok",
  "grok",
  "phean",
  "grok",
];

/** The beat each window opens at, where the windows overlap (a phone); all but the chat close at the loop's end. */
export const HANDOFF_OPENS: Record<HandoffWindow, number> = { grok: 0, phean: 3, claude: 4 };

/** The beat at `elapsed` milliseconds into the loop. */
export function beatAt(elapsed: number): number {
  let left = ((elapsed % HANDOFF_LOOP_MS) + HANDOFF_LOOP_MS) % HANDOFF_LOOP_MS;
  for (const [beat, ms] of HANDOFF_BEATS.entries()) {
    if (left < ms) return beat;
    left -= ms;
  }
  return HANDOFF_END;
}

/** The windows open at a beat, as `data-open` lists them. */
export function openAt(beat: number): string {
  return (Object.keys(HANDOFF_OPENS) as HandoffWindow[])
    .filter((window) => window === "grok" || (beat >= HANDOFF_OPENS[window] && beat < HANDOFF_END))
    .join(" ");
}

/**
 * Shown from beat `from` until beat `to` (exclusive): the attributes the stylesheet reads to bring a
 * piece of the stage in and out as the stage's `--beat` moves. `delay` staggers pieces within a beat;
 * `swap` replaces in place instead of rising, for states that take each other's place; `flow` takes
 * no room until it arrives, for the lines of a conversation or a log that grows from the bottom;
 * `pulse` is a stroke that runs once along its line as the beat starts (a handoff or webhook on its way).
 */
export function shown(
  from: number,
  to: number = HANDOFF_END,
  { delay = 0, swap = false, flow = false, pulse = false }: { delay?: number; swap?: boolean; flow?: boolean; pulse?: boolean } = {},
) {
  return {
    "data-at": swap ? "swap" : flow ? "flow" : pulse ? "pulse" : "",
    style: {
      "--in": from,
      "--out": to,
      // A piece that lasts to the end stays through the last beat, wiping away with the rest. Always
      // set, since custom properties inherit: a piece inside a held one must not be held itself.
      "--hold": to === HANDOFF_END ? 1 : 0,
      ...(delay && { transitionDelay: `${delay}ms` }),
    } as CSSProperties,
  };
}
