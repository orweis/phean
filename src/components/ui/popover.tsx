import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

import { buttonClasses, type ButtonVariant } from "./button";

interface PopoverProps {
  label: ReactNode;
  children: ReactNode;
  variant?: ButtonVariant;
  align?: "left" | "right";
  className?: string;
}

/**
 * A small disclosure panel built on <details>, so it works without client JavaScript.
 * On phones the trigger can sit anywhere in a wrapped row, so the panel spans the screen instead.
 */
export function Popover({ label, children, variant = "secondary", align = "right", className }: PopoverProps) {
  return (
    <details className="group relative">
      <summary className={cx(buttonClasses(variant, "sm"), "list-none [&::-webkit-details-marker]:hidden")}>{label}</summary>
      <div
        className={cx(
          "absolute z-20 mt-2 w-80 rounded-lg border border-rule bg-panel p-4 shadow-pop",
          "max-sm:fixed max-sm:inset-x-4 max-sm:top-20 max-sm:mt-0 max-sm:max-h-[calc(100dvh-6rem)] max-sm:w-auto max-sm:overflow-y-auto",
          align === "right" ? "sm:right-0" : "sm:left-0",
          className,
        )}
      >
        {children}
      </div>
    </details>
  );
}
