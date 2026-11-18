"use client";

import { useEffect, useState } from "react";

import { appearanceCookie, colorSchemeFor, parseAppearance, type Appearance } from "@/lib/appearance";
import { parseTheme, themeColorFor, themeCookie, type ThemeId } from "@/lib/themes";

/**
 * How the app looks for this person: the appearance (Light, Dark, System) and the colour theme,
 * both on `<html>` (`data-appearance`, `data-theme`) and both kept in a cookie the server reads, so
 * every later page renders in them from its first paint. Changing either repaints the open page at once.
 */
function repaint(change: (root: HTMLElement) => void) {
  const root = document.documentElement;
  root.dataset.appearanceChanging = "";
  change(root);
  const appearance = parseAppearance(root.dataset.appearance);
  const theme = parseTheme(root.dataset.theme);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", colorSchemeFor(appearance));
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = themeColorFor(theme, appearance, meta.media.includes("dark") ? "dark" : "light");
  }
  // Reading a style commits the new colours while transitions are still off.
  void getComputedStyle(document.body).backgroundColor;
  setTimeout(() => delete root.dataset.appearanceChanging, 1);
}

const secure = () => location.protocol === "https:";

export function applyAppearance(appearance: Appearance) {
  repaint((root) => {
    root.dataset.appearance = appearance;
    document.cookie = appearanceCookie(appearance, secure());
  });
}

export function applyTheme(theme: ThemeId) {
  repaint((root) => {
    root.dataset.theme = theme;
    document.cookie = themeCookie(theme, secure());
  });
}

/**
 * A choice held on `<html>`, as state: set at once by this picker, and followed when another picker
 * on the page (the account menu's, the account page's) changes it.
 */
export function useRootChoice<T extends string>(attribute: "appearance" | "theme", initial: T, parse: (value: unknown) => T): [T, (value: T) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setValue(parse(root.dataset[attribute])));
    observer.observe(root, { attributes: true, attributeFilter: [`data-${attribute}`] });
    return () => observer.disconnect();
  }, [attribute, parse]);
  return [value, setValue];
}
