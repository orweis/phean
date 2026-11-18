"use client";

import { Check } from "lucide-react";
import { useId } from "react";

import { cx } from "@/lib/cx";
import { parseTheme, THEME_META, THEMES, type ThemeId } from "@/lib/themes";

import { applyTheme, useRootChoice } from "./look";

export type ThemeSwatchSize = "sm" | "md" | "lg";

/**
 * A theme's colours in miniature: its ground, a card on it, the brand and the signal. `data-theme` on
 * the swatch scopes the tokens to that theme, in the appearance in force, so it shows the real thing.
 * The large one (the Account page) is a small picture of the app itself: the bar with the boulder's
 * ember and the selected tab, and a card holding a line of text, the four stations and a brand button.
 */
export function ThemeSwatch({ theme, size = "md", className }: { theme: ThemeId; size?: ThemeSwatchSize; className?: string }) {
  if (size === "lg") {
    return (
      <span data-theme={theme} aria-hidden className={cx("flex h-22 flex-col gap-1.5 rounded-md border border-rule bg-paper p-2", className)}>
        <span className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full bg-signal" />
          <span className="h-1.5 w-7 rounded-full bg-ink/70" />
          <span className="ml-auto h-3 w-8 rounded-full bg-accent-tint" />
        </span>
        <span className="flex min-h-0 flex-1 flex-col justify-between rounded-sm border border-rule bg-panel p-1.5">
          <span className="h-1.5 w-3/4 rounded-full bg-ink-2/45" />
          <span className="flex h-1.5 gap-0.5">
            <span className="flex-2 rounded-full bg-station-inbox" />
            <span className="flex-3 rounded-full bg-station-todo" />
            <span className="flex-3 rounded-full bg-station-progress" />
            <span className="flex-4 rounded-full bg-station-done" />
          </span>
          <span className="h-2.5 w-9 self-end rounded-full bg-accent" />
        </span>
      </span>
    );
  }
  return (
    <span
      data-theme={theme}
      aria-hidden
      className={cx("flex items-center gap-1 rounded-sm border border-rule bg-paper p-1", size === "sm" ? "h-6" : "h-8", className)}
    >
      <span className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-xs bg-panel px-1">
        <span className="h-1.5 w-1/2 rounded-full bg-accent" />
      </span>
      <span className="size-2.5 shrink-0 rounded-full bg-signal" />
    </span>
  );
}

/**
 * The colour theme, as a group of radios: a swatch and a name each, the selected one ringed in the
 * brand and checked, so the choice never rests on colour alone. Arrow keys move between them and a
 * choice applies at once; `compact` sets them in one row, for the site's footer.
 */
export function ThemePicker({
  initial,
  compact = false,
  size = compact ? "sm" : "md",
  className,
}: {
  initial: ThemeId;
  compact?: boolean;
  /** The swatch: `sm` in the site's footer, `md` in the account menu, `lg` (a picture of the app) on the Account page. */
  size?: ThemeSwatchSize;
  className?: string;
}) {
  const name = useId();
  const [current, setCurrent] = useRootChoice("theme", initial, parseTheme);
  return (
    <fieldset className={className}>
      <legend className="text-xs font-semibold text-ink-2">Theme</legend>
      <div className={cx("mt-2 grid", compact ? "grid-cols-4 gap-1.5" : size === "lg" ? "grid-cols-2 gap-2.5 sm:grid-cols-4" : "grid-cols-2 gap-1.5")}>
        {THEMES.map((theme) => {
          const selected = theme === current;
          const { label, description } = THEME_META[theme];
          return (
            <label
              key={theme}
              title={description}
              data-selected={selected ? "" : undefined}
              className={cx(
                "relative flex min-w-0 cursor-pointer flex-col rounded-md border border-rule bg-panel text-xs font-semibold text-ink-2",
                size === "lg" ? "gap-2 p-2" : "gap-1.5 p-1.5",
                "transition-[background-color,border-color,color] duration-(--dur-micro) hover:bg-fill hover:text-ink",
                "has-checked:border-accent has-checked:text-ink has-checked:shadow-[inset_0_0_0_1px_var(--color-accent)]",
                "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
              )}
            >
              <input
                type="radio"
                name={name}
                value={theme}
                checked={selected}
                onChange={() => {
                  setCurrent(theme);
                  applyTheme(theme);
                }}
                className="sr-only"
              />
              <ThemeSwatch theme={theme} size={size} />
              <span className="flex min-w-0 items-center justify-between gap-1">
                <span className="truncate">{label}</span>
                {selected && <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden />}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
