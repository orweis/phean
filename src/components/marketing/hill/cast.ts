import type { BotLook } from "./bot";

/*
 * Who is in the scene and where its marks are, as plain numbers: the three.js scene and the still
 * drawing that stands in for it (boulder-hill.tsx) both read them, and so does the loop's clock (timeline.ts). Nothing here loads three.js.
 */

export const BOULDER_R = 1.02;
/** Where along the path the boulder starts (out of the frame, below its left edge) and stops, as x; the person stands past the top (view.ts). */
export const START_X = -8.5;
export const TOP_X = 2.55;

/** The loop, in seconds: `--hill` in globals.css and LOOP_MS in hill-scene.tsx. */
export const LOOP_SECONDS = 18;
/** The loop's beats, as fractions of it. globals.css keys the decision card to the same ones. */
export const BEATS = {
  /** The boulder reaches the top, and the card shows. */
  top: 0.42,
  /** The person taps the answer. */
  tap: 0.545,
  /** The boulder gathers light, */
  charge: 0.552,
  /** goes in a flash, */
  flash: 0.585,
  /** and its light has died away. */
  dark: 0.65,
  /** The crew turns round, */
  turn: 0.685,
  /** and sets off down the hill. */
  descend: 0.7,
};
/** One of the crew: how it looks, how far behind the boulder's centre its feet are when it stands back from it (the push settles where it stands to push), and how far to our side of the path. */
export interface CrewLook extends BotLook {
  behind: number;
  aside: number;
  turn: number;
}

/** The crew, nose to tail as the hero draws them. */
export const CREW: CrewLook[] = [
  { scale: 0.96, behind: 1.62, aside: 0.12, turn: 0.75, antenna: 0.2, antennaAt: 0.06, antennaLean: -0.12 },
  { scale: 0.87, behind: 2.4, aside: 0.26, turn: 0.95, antenna: 0.13, antennaAt: -0.08, antennaLean: -0.3 },
  { scale: 0.79, behind: 3.1, aside: 0.12, turn: 0.6, antenna: 0.27, antennaAt: 0, antennaLean: 0.05 },
];

/** The idle motion (breathing, blinking, the antennas' sway) runs on a clock of this many beats a loop, so that left to the loop it comes round with it. */
export const IDLE_BEATS = 13;
export const IDLE_PER_MS = IDLE_BEATS / (LOOP_SECONDS * 1000);
