import { CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, type Texture } from "three";

import { clamp01, fbm, fbm2, noise3, smooth, worley } from "./noise";
import { pathZ } from "./terrain";

/*
 * The scene's surfaces, painted once when it loads: nothing is fetched. Every map is grey, so the
 * theme's colours tint it through the material; the stone glows wherever its emissive map is bright.
 */

function dataTexture(data: Uint8Array<ArrayBuffer>, width: number, height: number, color: boolean): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function put(data: Uint8Array, index: number, r: number, g: number, b: number) {
  data[index] = Math.round(clamp01(r) * 255);
  data[index + 1] = Math.round(clamp01(g) * 255);
  data[index + 2] = Math.round(clamp01(b) * 255);
  data[index + 3] = 255;
}

/* ---------------------------------------------------------------------------------------------- */
/* The boulder: plates of rock, cracked, the ember showing in the cracks.                          */

export interface Stone {
  /** How far the surface sits from the round, as a fraction of the radius. */
  dent: number;
  /** 0..1 in a crack. */
  crack: number;
  height: number;
  glow: number;
  shade: number;
  rough: number;
}

const stone: Stone = { dent: 0, crack: 0, height: 0, glow: 0, shade: 0, rough: 0 };

/** The stone at a point on the unit sphere; `fine` adds the grain only a texture can show. */
export function stoneAt(x: number, y: number, z: number, fine: boolean): Stone {
  const warpX = noise3(x * 2.4 + 9, y * 2.4, z * 2.4) - 0.5;
  const warpY = noise3(x * 2.4, y * 2.4 + 5, z * 2.4 + 3) - 0.5;
  const plates = worley(x * 2.3 + warpX * 0.9, y * 2.3 + warpY * 0.9, z * 2.3 + warpX * 0.6);
  const plate = plates.id;
  const edge = plates.f2 - plates.f1;
  const lumps = fbm(x * 1.4 + 3, y * 1.4, z * 1.4 + 7, 2);
  // Not every plate has split from its neighbour: the cracks come and go across the stone.
  const split = smooth((noise3(x * 2.3 + 11, y * 2.3 + 4, z * 2.3) - 0.4) / 0.25);
  const crack = (1 - smooth(edge / 0.07)) * (0.12 + 0.88 * split);
  stone.crack = crack;
  stone.dent = 0.085 * (lumps - 0.5) + 0.032 * (plate - 0.5) - 0.022 * crack;
  if (!fine) return stone;

  const grain = fbm(x * 14, y * 14, z * 14, 3);
  stone.height = 0.55 + 0.2 * (plate - 0.5) + 0.25 * (lumps - 0.5) + 0.34 * (grain - 0.5) - 0.4 * crack;
  // The ember inside: a slow warmth through the whole stone, molten where the rock has split.
  stone.glow = 0.46 + 0.36 * lumps * lumps + 0.08 * (plate - 0.5) + 0.5 * crack ** 1.3 - 0.18 * (grain - 0.5);
  stone.shade = 0.78 + 0.18 * (plate - 0.5) + 0.36 * (grain - 0.5) - 0.1 * crack;
  stone.rough = 0.92 - 0.4 * crack + 0.1 * (grain - 0.5);
  return stone;
}

export interface BoulderMaps {
  map: Texture;
  emissiveMap: Texture;
  /** Red is the height (the bump map), green the roughness. */
  detail: Texture;
}

/** Equirectangular maps, laid out as SphereGeometry lays out its uv, so the cracks sit where the dents are. */
export function boulderMaps(): BoulderMaps {
  const width = 384;
  const height = 192;
  const shade = new Uint8Array(width * height * 4);
  const glow = new Uint8Array(width * height * 4);
  const detail = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j += 1) {
    const theta = (1 - (j + 0.5) / height) * Math.PI;
    for (let i = 0; i < width; i += 1) {
      const phi = ((i + 0.5) / width) * Math.PI * 2;
      const s = stoneAt(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta), true);
      const index = (j * width + i) * 4;
      put(shade, index, s.shade, s.shade, s.shade);
      // The stone glows a deep ember; its cracks run hotter, towards white.
      const hot = smooth((s.glow - 0.8) / 0.4);
      put(glow, index, s.glow, s.glow * (0.84 + 0.2 * hot), s.glow * (0.62 + 0.45 * hot));
      put(detail, index, s.height, s.rough, 0);
    }
  }
  return { map: dataTexture(shade, width, height, true), emissiveMap: dataTexture(glow, width, height, true), detail: dataTexture(detail, width, height, false) };
}

/* ---------------------------------------------------------------------------------------------- */
/* The ground.                                                                                     */

/** The part of the hill the ground map covers, in world units. */
export const GROUND = { x: -17.5, z: -9, width: 36, depth: 24 };

/** How much lighter the path is than the grass around it: the map is 1 on the path, this on the grass. */
export const GRASS_SHADE = 0.56;

/** The hill from above: chalky grass, mottled, and the path a lighter worn strip winding up it. */
export function groundMap(): Texture {
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j += 1) {
    const z = GROUND.z + ((j + 0.5) / size) * GROUND.depth;
    for (let i = 0; i < size; i += 1) {
      const x = GROUND.x + ((i + 0.5) / size) * GROUND.width;
      const mottle = fbm2(x * 0.55, z * 0.55, 1, 3);
      const grain = fbm2(x * 4.5, z * 4.5, 4, 2);
      let value = GRASS_SHADE * (0.84 + 0.22 * mottle + 0.3 * (grain - 0.5));
      // The path: worn widest where feet have turned, its edges ragged, a few scuffs along it.
      const scuff = fbm2(x * 1.7, z * 1.7, 21, 2);
      const off = Math.abs(z - pathZ(x) + (scuff - 0.5) * 0.22);
      if (off < 0.5) {
        const worn = (1 - smooth((off - 0.17) / 0.3)) * (0.7 + 0.3 * grain + 0.2 * (scuff - 0.5));
        value += (0.98 - value) * 0.85 * worn;
      }
      const index = (j * size + i) * 4;
      put(data, index, value, value, value);
    }
  }
  const texture = dataTexture(data, size, size, true);
  texture.anisotropy = 8;
  return texture;
}

/** A grain that tiles: the chalk of the illustrations, as a bump map for the ground and the clay. */
export function grainMap(): Texture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const u = (i / size) * 8;
      const v = (j / size) * 8;
      const value = 0.5 + 0.55 * (fbm2(u, v, 2, 4, 8) - 0.5) + 0.35 * (fbm2(u * 4, v * 4, 6, 2, 32) - 0.5);
      put(data, (j * size + i) * 4, value, value, value);
    }
  }
  return dataTexture(data, size, size, false);
}

/* ---------------------------------------------------------------------------------------------- */
/* The crew's shells and the person's sweater.                                                     */

function canvasTexture(size: number, draw: (context: CanvasRenderingContext2D, size: number) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function speckle(context: CanvasRenderingContext2D, size: number, amount: number) {
  const image = context.getImageData(0, 0, size, size);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const index = (j * size + i) * 4;
      const grain = 1 + amount * (fbm2((i / size) * 24, (j / size) * 24, 3, 3, 24) - 0.5);
      for (let c = 0; c < 3; c += 1) image.data[index + c] = Math.min(255, image.data[index + c]! * grain);
    }
  }
  context.putImageData(image, 0, 0);
}

/**
 * One face of a bot's shell: a pressed panel with a seam around it, a seam across it, and a screw in
 * each corner. Light is the shell and dark the seams, so it serves as the colour and the bump alike.
 */
export function panelMap(): Texture {
  return canvasTexture(256, (context, size) => {
    context.fillStyle = "#f4f4f4";
    context.fillRect(0, 0, size, size);
    context.lineCap = "round";
    const seam = (width: number, shade: string, path: () => void) => {
      context.strokeStyle = shade;
      context.lineWidth = width;
      context.beginPath();
      path();
      context.stroke();
    };
    const inset = size * 0.16;
    for (const [width, shade] of [
      [9, "#c9c9c9"],
      [4, "#7e7e7e"],
    ] as const) {
      seam(width, shade, () => context.roundRect(inset, inset, size - inset * 2, size - inset * 2, size * 0.11));
      seam(width, shade, () => {
        context.moveTo(inset, size * 0.62);
        context.lineTo(size - inset, size * 0.62);
      });
    }
    for (const [x, y] of [
      [0.27, 0.27],
      [0.73, 0.27],
      [0.27, 0.5],
      [0.73, 0.5],
    ] as const) {
      context.fillStyle = "#8a8a8a";
      context.beginPath();
      context.arc(x * size, y * size, 5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#dcdcdc";
      context.beginPath();
      context.arc(x * size - 1, y * size - 1, 2.4, 0, Math.PI * 2);
      context.fill();
    }
    speckle(context, size, 0.14);
  });
}

/** Knitting, as the person's sweater in the illustrations: ribs of stitches, each a small chevron. */
export function knitMap(): Texture {
  return canvasTexture(128, (context, size) => {
    const image = context.createImageData(size, size);
    const ribs = 8;
    const rows = 12;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const u = (i / size) * ribs;
        const across = Math.abs((u % 1) - 0.5) * 2;
        const v = (j / size) * rows + across * 0.5;
        const along = Math.abs((v % 1) - 0.5) * 2;
        const stitch = 0.62 + 0.38 * Math.cos(across * Math.PI * 0.5) ** 0.7 * (0.72 + 0.28 * (1 - along * along));
        const value = Math.round(255 * clamp01(stitch));
        const index = (j * size + i) * 4;
        image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  });
}

/** A soft round glow, for the halo around the boulder, the phone and the lights on the crew. */
export function glowMap(): Texture {
  return canvasTexture(128, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.22, "rgba(255,255,255,0.5)");
    gradient.addColorStop(0.55, "rgba(255,255,255,0.12)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
}

/** A soft dark pool: the contact shadow under the boulder, which casts none of its own (it is the light). */
export function shadowMap(): Texture {
  return canvasTexture(128, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.9)");
    gradient.addColorStop(0.45, "rgba(0,0,0,0.5)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
}

/** The column of light the boulder leaves by: bright at its foot and its heart, thinning upward and outward, with rays running up it. */
export function beamMap(): Texture {
  return canvasTexture(128, (context, size) => {
    const image = context.createImageData(size, size);
    for (let j = 0; j < size; j += 1) {
      const up = 1 - j / (size - 1);
      const fall = (1 - up) ** 1.5 * Math.min(1, up * 14);
      for (let i = 0; i < size; i += 1) {
        const across = Math.sin((Math.PI * i) / (size - 1)) ** 2.4;
        const ray = 0.6 + 0.4 * fbm2((i / size) * 14, up * 1.5, 41, 2);
        const index = (j * size + i) * 4;
        image.data[index] = image.data[index + 1] = image.data[index + 2] = 255;
        image.data[index + 3] = Math.round(255 * clamp01(fall * across * ray));
      }
    }
    context.putImageData(image, 0, 0);
  });
}

/** A ring of light, for the ripple that runs out over the ground. */
export function ringMap(): Texture {
  return canvasTexture(128, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.05)");
    gradient.addColorStop(0.84, "rgba(255,255,255,0.9)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
}
