import type { Appearance, ColorScheme } from "./appearance";
import { isOneOf } from "./domain";

/**
 * The colour themes a person can pick, each a named set of tokens with a light and a dark value
 * (`lib/theme-tokens.ts`), rendered as `<html data-theme>` from the `phean-theme` cookie. The
 * appearance (Light, Dark, System) is a separate choice and works with every theme.
 */
export const THEMES = ["dusk", "ledger", "ink", "console"] as const;
export type ThemeId = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeId = "dusk";

export const THEME_COOKIE = "phean-theme";
const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export const THEME_META: Record<ThemeId, { label: string; description: string }> = {
  dusk: { label: "Dusk", description: "Slate and bone, a periwinkle brand and an apricot signal" },
  ledger: { label: "Ledger", description: "Phean's first look: lavender paper, violet and ember" },
  ink: { label: "Ink", description: "Plain black on white, with one teal" },
  console: { label: "Console", description: "Graphite, a cool blue instrument and amber for people" },
};

/** What a theme's swatch shows, in the theme's own colours (`data-theme` on the swatch scopes them). */
export const SWATCH_TOKENS = ["paper", "panel", "accent", "signal"] as const;

/**
 * The browser chrome takes each theme's paper in each scheme: the sRGB of its `--color-paper`,
 * which `tests/themes.test.ts` checks against the tokens.
 */
export const THEME_PAPER: Record<ThemeId, Record<ColorScheme, string>> = {
  dusk: { light: "#f3efea", dark: "#0e1017" },
  ledger: { light: "#f7f5fb", dark: "#0e0d17" },
  ink: { light: "#f7f7f5", dark: "#0b0b0b" },
  console: { light: "#f5f3ef", dark: "#0d1013" },
};

export function parseTheme(value: unknown): ThemeId {
  return isOneOf(THEMES, value) ? value : DEFAULT_THEME;
}

/** The `theme-color` for a theme, in the appearance chosen or, under System, the scheme a meta's media query names. */
export function themeColorFor(theme: ThemeId, appearance: Appearance, scheme: ColorScheme): string {
  return THEME_PAPER[theme][appearance === "system" ? scheme : appearance];
}

/** A `document.cookie` assignment that keeps the choice for a year on this origin. */
export function themeCookie(theme: ThemeId, secure: boolean): string {
  return [`${THEME_COOKIE}=${theme}`, "Path=/", `Max-Age=${THEME_MAX_AGE}`, "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}
