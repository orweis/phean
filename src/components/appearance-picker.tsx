"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useId } from "react";

import { APPEARANCES, parseAppearance, type Appearance } from "@/lib/appearance";
import { cx } from "@/lib/cx";

import { applyAppearance, useRootChoice } from "./look";
import { RADIO_SEGMENT, SEGMENTED } from "./ui/segmented";

const OPTIONS: Record<Appearance, { label: string; Icon: LucideIcon }> = {
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
  system: { label: "System", Icon: Monitor },
};

/** Light, Dark, or System, as a segmented control of radios. Works with every theme. */
export function AppearancePicker({ initial, className }: { initial: Appearance; className?: string }) {
  const name = useId();
  const [current, setCurrent] = useRootChoice("appearance", initial, parseAppearance);
  return (
    <fieldset className={className}>
      <legend className="text-xs font-semibold text-ink-2">Appearance</legend>
      <div className={cx(SEGMENTED, "mt-2")}>
        {APPEARANCES.map((value) => {
          const { label, Icon } = OPTIONS[value];
          return (
            <label key={value} data-selected={value === current ? "" : undefined} className={cx(RADIO_SEGMENT, "flex items-center justify-center gap-1.5")}>
              <input
                type="radio"
                name={name}
                value={value}
                checked={value === current}
                onChange={() => {
                  setCurrent(value);
                  applyAppearance(value);
                }}
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
