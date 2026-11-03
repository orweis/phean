import { isOneOf } from "./domain";

/** Light and Dark are fixed; System follows the device and changes with it. */
export const APPEARANCES = ["light", "dark", "system"] as const;
export type Appearance = (typeof APPEARANCES)[number];

export const COLOR_SCHEMES = ["light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export const APPEARANCE_COOKIE = "phean-appearance";
const APPEARANCE_MAX_AGE = 60 * 60 * 24 * 365;

/** The browser chrome takes the paper of each appearance (sRGB of `--color-paper`). */
const PAPER: Record<ColorScheme, string> = { light: "#f7f5fb", dark: "#0e0d17" };

export function parseAppearance(value: unknown): Appearance {
  return isOneOf(APPEARANCES, value) ? value : "system";
}

/** The `theme-color` for the device scheme a meta's media query names. */
export function themeColorFor(appearance: Appearance, scheme: ColorScheme): string {
  return PAPER[appearance === "system" ? scheme : appearance];
}

/** The `color-scheme` value, which sets the form controls and scrollbars before the stylesheet arrives. */
export function colorSchemeFor(appearance: Appearance): "light" | "dark" | "light dark" {
  return appearance === "system" ? "light dark" : appearance;
}

/** A `document.cookie` assignment that keeps the choice for a year on this origin. */
export function appearanceCookie(appearance: Appearance, secure: boolean): string {
  return [`${APPEARANCE_COOKIE}=${appearance}`, "Path=/", `Max-Age=${APPEARANCE_MAX_AGE}`, "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}
