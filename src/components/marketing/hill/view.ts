import { hillSurface, pathZ } from "./terrain";

/*
 * How the scene is seen, and the far things in it, as plain numbers: the three.js scene frames
 * itself with these, and the still drawing that stands in for it while it loads
 * (boulder-hill.tsx) is drawn through the same camera, so the one gives way to the other without
 * a jump. Nothing here needs three.js or a browser.
 */

/** The figure's shape, the canvas's and the drawing's: 15 by 8. */
export const ASPECT = 15 / 8;
/** The camera: its vertical field of view in degrees, how wide a stretch of hill it frames, and where it looks. */
export const FOV = 24;
const SPAN = 13.5;
export const LOOK_AT: readonly [number, number, number] = [-0.1, 3.15, 0];

/** Where the person stands, and how tall they are. */
export const PERSON_X = 5.05;
export const PERSON_Z = pathZ(PERSON_X) - 0.15;
export const PERSON_HEIGHT = 1.98;

/** Where the camera rests for a canvas of this shape: a little above, and a little down the hill, so the face of the hill and the crew's faces show. */
export function cameraHome(aspect: number): [number, number, number] {
  const horizontal = 2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * aspect);
  const distance = Math.max(11, SPAN / 2 / Math.tan(horizontal / 2));
  return [LOOK_AT[0] - distance * 0.05, LOOK_AT[1] + distance * 0.22, distance * 0.98];
}

/** Where the camera is and looks `turn` radians through the loop: it drifts, slowly, and comes back to where it began. */
export function cameraAt(aspect: number, turn: number): { from: [number, number, number]; to: [number, number, number] } {
  const [x, y, z] = cameraHome(aspect);
  return {
    from: [x + 0.34 * Math.sin(turn), y + 0.1 * Math.sin(turn * 2), z - 0.3 * Math.cos(turn)],
    to: [LOOK_AT[0] + 0.12 * Math.sin(turn), LOOK_AT[1], LOOK_AT[2]],
  };
}

/** The loop's first frame, through the camera: a point in the world as fractions of the canvas (x right, y down) and its distance. */
export function project(x: number, y: number, z: number): [number, number, number] {
  const { from, to } = cameraAt(ASPECT, 0);
  const f = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(f[0]!, f[1]!, f[2]!);
  const [fx, fy, fz] = [f[0]! / length, f[1]! / length, f[2]! / length];
  // Right is forward × up; up is right × forward.
  const flat = Math.hypot(fx, fz);
  const [rx, rz] = [-fz / flat, fx / flat];
  const [ux, uy, uz] = [-rz * fy, rz * fx - rx * fz, rx * fy];
  const [dx, dy, dz] = [x - from[0], y - from[1], z - from[2]];
  const depth = dx * fx + dy * fy + dz * fz;
  const tangent = Math.tan((FOV * Math.PI) / 360);
  const across = (dx * rx + dz * rz) / (depth * tangent * ASPECT);
  const up = (dx * ux + dy * uy + dz * uz) / (depth * tangent);
  return [(across + 1) / 2, (1 - up) / 2, depth];
}

/** Far hills: ridges one behind another, each paler than the last, as the hero's horizon. */
export const RIDGES = [
  { z: -9, base: -1.3, height: 1.3, phase: 0.4, haze: 0.22 },
  { z: -15, base: -2.5, height: 1.6, phase: 2.1, haze: 0.42 },
  { z: -22, base: -3.9, height: 2.0, phase: 4.4, haze: 0.6 },
  { z: -30, base: -5.4, height: 2.4, phase: 6.0, haze: 0.76 },
] as const;
export type Ridge = (typeof RIDGES)[number];

/** How far a ridge runs to either side, how far below its crest it is drawn, and its crest's height at x. */
export const ridgeHalf = (ridge: Ridge) => 30 - ridge.z * 0.9;
export const RIDGE_DROP = 16;
export function ridgeTop(ridge: Ridge, x: number): number {
  const roll = 0.3 * Math.sin(x * 0.19 + ridge.phase) + 0.15 * Math.sin(x * 0.43 + ridge.phase * 2.3) + 0.08 * Math.sin(x * 0.9 + ridge.phase * 0.7);
  return ridge.base + ridge.height * roll;
}

/** The sky's plane behind the ridges, the stops of its warmth from top to bottom (how far down, how strong), and the glow on the horizon. */
export const SKY = { x: -2, y: -4, z: -40, width: 64, height: 32 };
export const SKY_STOPS = [
  [0, 0],
  [0.25, 0.05],
  [0.44, 0.3],
  [0.54, 0.55],
  [0.61, 0.88],
  [1, 1],
] as const;
export const HORIZON = { x: -12, y: -8, z: -36, width: 52, height: 13, strength: 0.5 };

/** A few stars, high in the band: fixed, so every visit sees the same sky. */
export const STARS = 80;
export function starAt(index: number): [number, number, number] {
  const a = Math.sin(index * 12.9898) * 43758.5453;
  const b = Math.sin(index * 78.233) * 12345.678;
  return [(a - Math.floor(a) - 0.5) * 60, -3 + (b - Math.floor(b)) * 9, -38];
}

/** The hill's skyline as the camera sees it: for each of `columns` steps across the canvas, the highest the ground reaches (as a fraction down it). */
export function skyline(columns: number): number[] {
  const top = new Array<number>(columns + 1).fill(1.2);
  for (let x = -17; x <= 18; x += 0.08) {
    for (let z = -6; z <= 12; z += 0.2) {
      const [u, v] = project(x, hillSurface(x, z), z);
      const column = Math.round(u * columns);
      if (column >= 0 && column <= columns && v < top[column]!) top[column] = v;
    }
  }
  return top;
}
