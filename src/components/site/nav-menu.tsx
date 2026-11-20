"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * One of the header's menus (the disclosure pattern): a button that opens a panel of links. The links
 * are rendered on the server and stay in the page when closed, so crawlers and answer engines read
 * them. Opens on click, on Enter or Space, and on hover with a mouse; Escape, a click outside, focus
 * leaving, or following a link closes it.
 */
export function NavMenu({ label, children, align = "left" }: { label: string; children: ReactNode; align?: "left" | "center" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const hover = (next: boolean) => (event: ReactPointerEvent) => {
    if (event.pointerType !== "mouse") return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(next), next ? 60 : 160);
  };

  return (
    <div
      ref={root}
      className="relative"
      onPointerEnter={hover(true)}
      onPointerLeave={hover(false)}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
        className={cx(
          "inline-flex h-9 items-center gap-1 rounded-full px-3.5 text-sm font-semibold transition-colors",
          open ? "bg-fill text-ink" : "text-ink-2 hover:bg-fill hover:text-ink",
        )}
      >
        {label}
        <ChevronDown aria-hidden className={cx("size-3.5 text-muted transition-transform", open && "rotate-180")} />
      </button>
      <div
        id={id}
        hidden={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpen(false);
        }}
        className={cx("absolute top-full z-40 pt-2", align === "center" ? "left-1/2 -translate-x-1/2" : "left-0")}
      >
        <div className="glass-float rounded-xl p-2">{children}</div>
      </div>
    </div>
  );
}
