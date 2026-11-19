import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrast, luminance, parseOklch, toHex } from "@/lib/color";
import { renderThemeCss } from "@/lib/theme-css";
import { COLOR_TOKENS, resolveColor, THEME_TOKENS, type ColorToken } from "@/lib/theme-tokens";
import { DEFAULT_THEME, parseTheme, SWATCH_TOKENS, THEME_COOKIE, THEME_META, THEME_PAPER, themeColorFor, themeCookie, THEMES } from "@/lib/themes";

/** Text a component sets on a surface: 4.5:1 (WCAG 1.4.3). */
const TEXT: [ColorToken, ColorToken][] = [
  ["ink", "paper"],
  ["ink", "panel"],
  ["ink", "fill"],
  ["ink", "raised"],
  ["ink", "accent-tint"],
  ["ink-2", "paper"],
  ["ink-2", "panel"],
  ["ink-2", "fill"],
  ["muted", "paper"],
  ["muted", "panel"],
  ["on-accent", "accent"],
  ["on-accent", "accent-2"],
  ["accent-ink", "paper"],
  ["accent-ink", "panel"],
  ["accent-ink", "accent-tint"],
  ["on-signal", "signal"],
  ["on-signal", "signal-2"],
  ["signal-ink", "signal-tint"],
  ["signal-ink", "panel"],
  ["late-ink", "late-tint"],
  ["late-ink", "panel"],
  ["late-ink", "paper"],
  ["wait-ink", "wait-tint"],
  ["wait-ink", "panel"],
  ["inbox-ink", "inbox-tint"],
  ["inbox-ink", "panel"],
  ["move-ink", "move-tint"],
  ["arrive-ink", "arrive-tint"],
  ["arrive-ink", "panel"],
  ["dusk-ink", "dusk"],
  ["dusk-ink", "dusk-2"],
  ["dusk-muted", "dusk"],
  ["dusk-muted", "dusk-2"],
  ["on-signal", "signal"],
];

/** Lines, rings and marks that must be seen against what is behind them: 3:1 (WCAG 1.4.11). */
const MARKS: [ColorToken, ColorToken][] = [
  ["edge", "panel"],
  ["edge", "paper"],
  ["focus", "paper"],
  ["focus", "panel"],
  ["late", "panel"],
  ["line-inbox", "panel"],
  ["line-todo", "panel"],
  ["line-backlog", "panel"],
  ["station-progress", "panel"],
  ["station-done", "panel"],
  ["accent", "panel"],
  ["signal", "dusk"],
  ["dusk-hill", "dusk"],
];

describe("themes", () => {
  it("defaults to Dusk, for a missing or unknown choice", () => {
    expect(DEFAULT_THEME).toBe("dusk");
    expect(parseTheme(undefined)).toBe("dusk");
    expect(parseTheme("sepia")).toBe("dusk");
    for (const theme of THEMES) expect(parseTheme(theme)).toBe(theme);
  });

  it("names every theme, and gives each a set of tokens", () => {
    expect(Object.keys(THEME_META).sort()).toEqual([...THEMES].sort());
    expect(Object.keys(THEME_TOKENS).sort()).toEqual([...THEMES].sort());
    for (const theme of THEMES) {
      for (const scheme of ["light", "dark"] as const) {
        expect(Object.keys(THEME_TOKENS[theme][scheme].colors).sort(), `${theme} ${scheme}`).toEqual([...COLOR_TOKENS].sort());
      }
    }
    for (const token of SWATCH_TOKENS) expect(COLOR_TOKENS).toContain(token);
  });

  it("keeps the choice for a year, and only over HTTPS when the page is secure", () => {
    expect(themeCookie("ink", true)).toBe(`${THEME_COOKIE}=ink; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
    expect(themeCookie("dusk", false)).not.toContain("Secure");
  });

  it("gives the browser chrome each theme's paper, in the appearance chosen or the device's under System", () => {
    for (const theme of THEMES) {
      for (const scheme of ["light", "dark"] as const) {
        expect(THEME_PAPER[theme][scheme], `${theme} ${scheme}`).toBe(toHex(THEME_TOKENS[theme][scheme].colors.paper));
      }
    }
    expect(themeColorFor("ledger", "system", "light")).toBe("#f7f5fb");
    expect(themeColorFor("ledger", "system", "dark")).toBe("#0e0d17");
    expect(themeColorFor("ledger", "dark", "light")).toBe("#0e0d17");
    expect(themeColorFor("dusk", "light", "dark")).toBe(THEME_PAPER.dusk.light);
  });

  it("writes the stylesheet the app loads from the tokens (run `pnpm themes` after changing them)", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../src/app/themes.css"), "utf8");
    expect(css).toBe(renderThemeCss());
  });

  for (const theme of THEMES) {
    for (const scheme of ["light", "dark"] as const) {
      const { colors } = THEME_TOKENS[theme][scheme];
      const color = (token: ColorToken) => resolveColor(colors, token);

      it(`${theme} in ${scheme} sets every text pair at 4.5:1 or better`, () => {
        const failing = TEXT.map(([fg, bg]) => ({ pair: `${fg} on ${bg}`, ratio: Number(contrast(color(fg), color(bg)).toFixed(2)) })).filter(({ ratio }) => ratio < 4.5);
        expect(failing).toEqual([]);
      });

      it(`${theme} in ${scheme} sets every line and mark at 3:1 or better`, () => {
        const failing = MARKS.map(([fg, bg]) => ({ pair: `${fg} on ${bg}`, ratio: Number(contrast(color(fg), color(bg)).toFixed(2)) })).filter(({ ratio }) => ratio < 3);
        expect(failing).toEqual([]);
      });

      it(`${theme} in ${scheme} is the scheme it says, with opaque surfaces`, () => {
        const paper = luminance(color("paper"));
        const ink = luminance(color("ink"));
        expect(scheme === "light" ? paper > ink : paper < ink).toBe(true);
        for (const token of ["paper", "panel", "fill", "raised", "accent", "signal", "dusk", "dusk-ink"] as const) expect(parseOklch(color(token)).alpha).toBe(1);
      });

      it(`${theme} in ${scheme} keeps the QR code dark on light, at 7:1 or better`, () => {
        expect(luminance(color("dusk-ink"))).toBeGreaterThan(luminance(color("dusk")));
        expect(contrast(color("dusk-ink"), color("dusk"))).toBeGreaterThanOrEqual(7);
      });

      it(`${theme} in ${scheme} keeps red for lateness, and each station its own hue`, () => {
        const hue = (token: ColorToken) => parseOklch(color(token)).h;
        const lateHue = hue("late");
        expect(lateHue >= 15 && lateHue <= 30, "late is red").toBe(true);
        // Signal is warm: an ember, apricot or amber, never red.
        expect(hue("signal") >= 40 && hue("signal") <= 90, "signal is warm").toBe(true);
        const stations = ["station-inbox", "station-todo", "station-progress", "station-done"] as const;
        for (const [index, a] of stations.entries()) {
          for (const b of stations.slice(index + 1)) {
            const gap = Math.abs(hue(a) - hue(b));
            expect(Math.min(gap, 360 - gap), `${a} and ${b} differ in hue`).toBeGreaterThanOrEqual(25);
          }
        }
        // Backlog is a grey, so it reads as parked next to the coloured stations.
        expect(parseOklch(color("station-backlog")).c).toBeLessThan(0.03);
      });
    }
  }
});
