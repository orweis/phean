"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cx } from "@/lib/cx";

import { buttonClasses, type ButtonVariant } from "./button";

interface PopoverProps {
  label: ReactNode;
  /** An icon element (not a component: server pages render this client component). */
  icon?: ReactNode;
  children: ReactNode;
  variant?: ButtonVariant;
  /** "link" sets the trigger as a compact text link, for panels that lead elsewhere rather than act. */
  look?: "button" | "link";
  align?: "left" | "right";
  className?: string;
  triggerClassName?: string;
}

/** The pseudo-element extends the hit target to 44px, like small buttons. */
const LINK_TRIGGER =
  "relative inline-flex h-8 cursor-pointer items-center gap-1 rounded-sm text-xs font-semibold text-accent-ink after:absolute after:-inset-x-1 after:-inset-y-1.5 hover:underline [&_svg]:size-3.5";

/**
 * A small disclosure panel built on <details>, so it opens and closes from its trigger without
 * client JavaScript. With it, Escape and a click outside close the panel too. On phones the trigger
 * can sit anywhere in a wrapped row, so the panel becomes a sheet across the top of the screen, over
 * the header, and carries its own close button.
 */
export function Popover({ label, icon, children, variant = "secondary", look = "button", align = "right", className, triggerClassName }: PopoverProps) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary className={cx(look === "link" ? LINK_TRIGGER : buttonClasses(variant, "sm"), "list-none [&::-webkit-details-marker]:hidden", triggerClassName)}>
        {icon}
        {label}
      </summary>
      <div
        className={cx(
          "glass-float absolute z-40 mt-2 w-80 origin-top rounded-xl p-4 motion-safe:animate-glass-in",
          "max-sm:fixed max-sm:inset-x-3 max-sm:top-3 max-sm:mt-0 max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:w-auto max-sm:overflow-y-auto",
          align === "right" ? "sm:right-0" : "sm:left-0",
          className,
        )}
      >
        <div className="-mt-2 -mr-2 mb-1 flex justify-end sm:hidden">
          <button
            type="button"
            aria-label="Close"
            className={buttonClasses("ghost", "sm")}
            onClick={() => {
              if (ref.current) ref.current.open = false;
            }}
          >
            <X aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </details>
  );
}
