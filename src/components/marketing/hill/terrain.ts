/**
 * The hill: one long rise from the lower left to a crest on the right, as the hero illustration
 * draws it, with a worn path winding up its face. Everything that stands on it asks these functions
 * where the ground is.
 */

const SLOPE = 0.27;
const RISE_FROM = -6.6;
const RISE_TO = 4.1;
const SHARPNESS = 1.15;

function softplus(u: number): number {
  const k = SHARPNESS * u;
  return k > 30 ? u : Math.log(1 + Math.exp(k)) / SHARPNESS;
}

/** Height of the hill's ridge line at x. */
export function hillY(x: number): number {
  return SLOPE * (softplus(x - RISE_FROM) - softplus(x - RISE_TO)) - 0.035 * Math.max(0, x - 6.5) ** 2;
}

/** Where the path runs, as z for an x: wide turns low on the hill, straightening towards the crest. */
export function pathZ(x: number): number {
  const sway = 0.25 + 0.75 / (1 + Math.exp((x - 0.2) * 0.8));
  return 0.95 * sway * Math.sin(x * 0.82 + 0.9) + 0.18 * sway * Math.sin(x * 1.9 + 2.2);
}

/** How far the hill's face tilts towards the camera, as rise over run. */
export const FACE = 0.12;

/**
 * The surface: the hill's face tilts towards the camera, so the path lies open on it, rises a little
 * way behind the path to the skyline, and falls away beyond.
 */
export function hillSurface(x: number, z: number): number {
  const beyond = Math.max(0, -z - 1.4);
  return hillY(x) - FACE * z - (z > 0 ? 0.012 * z * z : 0.07 * beyond * beyond);
}

/** The ground under the path at x. */
export function pathPoint(x: number): [number, number, number] {
  const z = pathZ(x);
  return [x, hillSurface(x, z), z];
}

/** The path's climb at x, as rise over run along x. */
export function pathSlope(x: number): number {
  const h = 0.02;
  return (pathPoint(x + h)[1] - pathPoint(x - h)[1]) / (2 * h);
}

/** The path's turn at x: dz/dx. */
export function pathTurn(x: number): number {
  const h = 0.02;
  return (pathZ(x + h) - pathZ(x - h)) / (2 * h);
}

/** How far along the path x is, measured on the ground from `from`. */
export function pathLength(from: number, x: number): number {
  const steps = Math.max(1, Math.ceil(Math.abs(x - from) / 0.1));
  let length = 0;
  let previous = pathPoint(from);
  for (let i = 1; i <= steps; i += 1) {
    const next = pathPoint(from + ((x - from) * i) / steps);
    length += Math.hypot(next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]);
    previous = next;
  }
  return x < from ? -length : length;
}
