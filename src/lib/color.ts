/**
 * OKLCH to sRGB, and WCAG contrast between two colours. The themes are written in OKLCH
 * (`lib/theme-tokens.ts`); this turns them into what a browser paints, so the contrast test and the
 * `theme-color` meta work from the same values as the stylesheet.
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
  alpha: number;
}

const OKLCH = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/;

/** Parses `oklch(L% C H)` or `oklch(L% C H / A)`, the one form the themes use. */
export function parseOklch(value: string): Oklch {
  const match = OKLCH.exec(value.trim());
  if (!match) throw new Error(`Not an oklch() colour: ${value}`);
  const [, l, c, h, alpha] = match;
  return { l: Number(l) / 100, c: Number(c), h: Number(h), alpha: alpha === undefined ? 1 : Number(alpha) };
}

/** Linear sRGB channels (0 to 1, clamped to the gamut the way a browser maps an out-of-gamut colour, roughly). */
export function linearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb: [number, number, number] = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return rgb.map((channel) => Math.min(1, Math.max(0, channel))) as [number, number, number];
}

const encode = (channel: number) => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055);

/** The colour as `#rrggbb`, ignoring alpha. */
export function toHex(value: string): string {
  return `#${linearSrgb(parseOklch(value))
    .map((channel) => Math.round(encode(channel) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** WCAG relative luminance, from the sRGB the colour encodes to (as WCAG defines it, on 8-bit channels). */
export function luminance(value: string): number {
  const [r, g, b] = linearSrgb(parseOklch(value)).map((channel) => {
    const srgb = Math.round(encode(channel) * 255) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two opaque colours, from 1 to 21. */
export function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
