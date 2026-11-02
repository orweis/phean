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

/** A small disclosure panel built on <details>, so it works without client JavaScript. */
export function Popover({ label, children, variant = "secondary", align = "right", className }: PopoverProps) {
  return (
    <details className="group relative">
      <summary className={cx(buttonClasses(variant, "sm"), "list-none [&::-webkit-details-marker]:hidden")}>{label}</summary>
      <div
        className={cx(
          "absolute z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-rule bg-panel p-4 shadow-pop",
          align === "right" ? "right-0" : "left-0",
          className,
        )}
      >
        {children}
      </div>
    </details>
  );
}
