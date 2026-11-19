import { BEATS, LOOP_SECONDS } from "./cast";

/*
 * The loop over time, and the visitor's turn in it. The scene plays through by itself three times;
 * the fourth time the crew reaches the top it stops there, the question on the card, and waits for
 * the visitor to make the call. When they do, it goes on from that moment, and plays three more
 * loops before it asks again.
 *
 * Time here is the loop's own clock (the CSS animation's, in milliseconds), which only runs while
 * the loop does. Everything is a function of that time and of how many calls the visitor has made:
 * if the clock ran on while nobody was looking (the figure off screen, the tab hidden), the moment
 * is still the hold it should have stopped at, never a later loop.
 */

export const LOOP_MS = LOOP_SECONDS * 1000;
/** How many loops play through before the one that waits. */
export const AUTO_LOOPS = 3;
/** Where in the loop it waits: the question read, the answer not yet tapped. */
export const HOLD_AT = BEATS.tap - 0.03;

/** When the clock stops for the visitor's next call, given how many they have made. */
export function holdTime(answered: number): number {
  return (answered * (AUTO_LOOPS + 1) + AUTO_LOOPS + HOLD_AT) * LOOP_MS;
}

export interface Moment {
  /** Where the clock belongs: `elapsed`, or the hold it should not have passed. */
  time: number;
  /** 0..1 through the loop. */
  progress: number;
  /** Which loop this is, from 1. */
  loop: number;
  /** Waiting for the visitor's call. */
  held: boolean;
}

/** The moment the loop is at, `elapsed` milliseconds into its clock, the visitor having made `answered` calls. */
export function momentAt(elapsed: number, answered: number): Moment {
  const hold = holdTime(answered);
  const time = Math.min(Math.max(0, elapsed), hold);
  return { time, progress: (time % LOOP_MS) / LOOP_MS, loop: Math.floor(time / LOOP_MS) + 1, held: elapsed >= hold };
}
