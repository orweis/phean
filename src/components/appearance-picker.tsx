"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useId } from "react";

import { APPEARANCES, appearanceCookie, colorSchemeFor, themeColorFor, type Appearance } from "@/lib/appearance";
import { cx } from "@/lib/cx";

import { RADIO_SEGMENT, SEGMENTED } from "./ui/segmented";

const OPTIONS: Record<Appearance, { label: string; Icon: LucideIcon }> = {
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
  system: { label: "System", Icon: Monitor },
};

/** Switches the open page at once and saves the choice for the server, which renders every later page in it. */
function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  root.dataset.appearanceChanging = "";
  root.dataset.appearance = appearance;
  document.cookie = appearanceCookie(appearance, location.protocol === "https:");
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", colorSchemeFor(appearance));
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = themeColorFor(appearance, meta.media.includes("dark") ? "dark" : "light");
  }
  // Reading a style commits the new colours while transitions are still off.
  void getComputedStyle(document.body).backgroundColor;
  setTimeout(() => delete root.dataset.appearanceChanging, 1);
}

/** Light, Dark, or System, as a segmented control of radios. */
export function AppearancePicker({ initial, className }: { initial: Appearance; className?: string }) {
  const name = useId();
  return (
    <fieldset className={className}>
      <legend className="text-xs font-semibold text-ink-2">Appearance</legend>
      <div className={cx(SEGMENTED, "mt-2")}>
        {APPEARANCES.map((value) => {
          const { label, Icon } = OPTIONS[value];
          return (
            <label key={value} className={cx(RADIO_SEGMENT, "flex items-center justify-center gap-1.5")}>
              <input
                type="radio"
                name={name}
                value={value}
                defaultChecked={value === initial}
                onChange={() => applyAppearance(value)}
                className="sr-only"
              />
              <Icon className="size-3.5 shrink-0" aria-hidden />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
