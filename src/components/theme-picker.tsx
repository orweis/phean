"use client";

import { Check } from "lucide-react";
import { useId } from "react";

import { cx } from "@/lib/cx";
import { parseTheme, THEME_META, THEMES, type ThemeId } from "@/lib/themes";

import { applyTheme, useRootChoice } from "./look";

/**
 * A theme's colours in miniature: its ground, a card on it, the brand and the signal. `data-theme` on
 * the swatch scopes the tokens to that theme, in the appearance in force, so it shows the real thing.
 */
export function ThemeSwatch({ theme, className }: { theme: ThemeId; className?: string }) {
  return (
    <span data-theme={theme} aria-hidden className={cx("flex items-center gap-1 rounded-sm border border-rule bg-paper p-1", className)}>
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
export function ThemePicker({ initial, compact = false, className }: { initial: ThemeId; compact?: boolean; className?: string }) {
  const name = useId();
  const [current, setCurrent] = useRootChoice("theme", initial, parseTheme);
  return (
    <fieldset className={className}>
      <legend className="text-xs font-semibold text-ink-2">Theme</legend>
      <div className={cx("mt-2 grid gap-1.5", compact ? "grid-cols-4" : "grid-cols-2")}>
        {THEMES.map((theme) => {
          const selected = theme === current;
          const { label, description } = THEME_META[theme];
          return (
            <label
              key={theme}
              title={description}
              data-selected={selected ? "" : undefined}
              className={cx(
                "relative flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-md border border-rule bg-panel p-1.5 text-xs font-semibold text-ink-2",
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
              <ThemeSwatch theme={theme} className={compact ? "h-6" : "h-8"} />
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
