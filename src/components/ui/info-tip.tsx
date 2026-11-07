"use client";

import { CircleHelp } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * A section's description, folded behind a small (?) so the heading takes one line. Hovering or
 * focusing the button shows it as a tooltip; clicking pins it open (the only way on a touchscreen),
 * and Escape or a click elsewhere closes it. The text stays in the page as the button's
 * description, so screen readers hear it with the button without opening anything.
 */
export function InfoTip({ about, children, className }: { about: string; children: ReactNode; className?: string }) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;

  useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPinned(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [pinned]);

  return (
    <span
      ref={root}
      className={cx("relative inline-flex align-middle", className)}
      onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(false)}
    >
      <button
        type="button"
        aria-label={`About ${about}`}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setPinned((value) => !value)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setPinned(false);
            setHovered(false);
          }
        }}
        className="relative inline-flex size-6 items-center justify-center rounded-full text-muted transition-colors duration-(--dur-micro) after:absolute after:-inset-2.5 hover:bg-fill hover:text-ink aria-expanded:bg-fill aria-expanded:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        <CircleHelp className="size-4" aria-hidden />
      </button>
      <div
        id={id}
        role="tooltip"
        // Closed, it is only for screen readers; `cx` does not merge, so the open layout is not kept beside `sr-only`.
        className={
          open
            ? "glass-float absolute top-full left-0 z-30 mt-1.5 w-max max-w-[min(24rem,calc(100vw-2rem))] rounded-xl px-3 py-2 text-left text-sm font-normal text-ink-2 motion-safe:animate-glass-in"
            : "sr-only"
        }
      >
        {children}
      </div>
    </span>
  );
}
