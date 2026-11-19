/** Small deterministic noise, for the scene's procedural textures and the boulder's dents. No randomness: every visit draws the same stone. */

function bits(ix: number, iy: number, iz: number): number {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440662683);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

function hash(ix: number, iy: number, iz: number): number {
  return bits(ix, iy, iz) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrap(i: number, period: number): number {
  return period ? ((i % period) + period) % period : i;
}

/** Value noise in 0..1. With `period`, it tiles every `period` units on x and y. */
export function noise3(x: number, y: number, z: number, period = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const x0 = wrap(ix, period);
  const x1 = wrap(ix + 1, period);
  const y0 = wrap(iy, period);
  const y1 = wrap(iy + 1, period);
  const a = hash(x0, y0, iz) + (hash(x1, y0, iz) - hash(x0, y0, iz)) * fx;
  const b = hash(x0, y1, iz) + (hash(x1, y1, iz) - hash(x0, y1, iz)) * fx;
  const c = hash(x0, y0, iz + 1) + (hash(x1, y0, iz + 1) - hash(x0, y0, iz + 1)) * fx;
  const d = hash(x0, y1, iz + 1) + (hash(x1, y1, iz + 1) - hash(x0, y1, iz + 1)) * fx;
  const front = a + (b - a) * fy;
  const back = c + (d - c) * fy;
  return front + (back - front) * fz;
}

/** Value noise on a plane, in 0..1: half the work of `noise3`. `seed` picks the plane. */
export function noise2(x: number, y: number, seed: number, period = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const x0 = wrap(ix, period);
  const x1 = wrap(ix + 1, period);
  const y0 = wrap(iy, period);
  const y1 = wrap(iy + 1, period);
  const a = hash(x0, y0, seed);
  const b = hash(x0, y1, seed);
  const near = a + (hash(x1, y0, seed) - a) * fx;
  const far = b + (hash(x1, y1, seed) - b) * fx;
  return near + (far - near) * fy;
}

/** Layered noise on a plane, in 0..1. */
export function fbm2(x: number, y: number, seed: number, octaves: number, period = 0): number {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  let scale = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += weight * noise2(x * scale, y * scale, seed + i * 17, period ? period * scale : 0);
    total += weight;
    weight *= 0.5;
    scale *= 2;
  }
  return sum / total;
}

/** Layered noise in 0..1. */
export function fbm(x: number, y: number, z: number, octaves: number, period = 0): number {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  let scale = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += weight * noise3(x * scale, y * scale, z + i * 17.3, period ? period * scale : 0);
    total += weight;
    weight *= 0.5;
    scale *= 2;
  }
  return sum / total;
}

export interface Cells {
  /** Distance to the nearest cell point, and to the second nearest. */
  f1: number;
  f2: number;
  /** A fixed 0..1 value for the nearest cell. */
  id: number;
}

const cells: Cells = { f1: 0, f2: 0, id: 0 };

/** Worley cells in three dimensions: the plates of a stone, and the cracks between them where f2 - f1 is small. */
export function worley(x: number, y: number, z: number): Cells {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        // One hash a cell: ten bits each for where its point sits, and the rest for what it is.
        const n = bits(cx, cy, cz);
        const px = cx + (n & 1023) / 1024 - x;
        const py = cy + ((n >>> 10) & 1023) / 1024 - y;
        const pz = cz + ((n >>> 20) & 1023) / 1024 - z;
        const d = px * px + py * py + pz * pz;
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = (Math.imul(n, 2654435761) >>> 8) / 16777216;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  cells.f1 = Math.sqrt(f1);
  cells.f2 = Math.sqrt(f2);
  cells.id = id;
  return cells;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function smooth(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/** 0 until `a`, 1 after `b`, smooth between. */
export function band(p: number, a: number, b: number): number {
  return smooth((p - a) / (b - a));
}
