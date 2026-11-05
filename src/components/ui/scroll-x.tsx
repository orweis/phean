"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * A sideways scroller for a wide table. While more of the table lies to the right it fades at
 * that edge, as the tab rail does, so a person can tell there is more to see (a Revoke button).
 */
export function ScrollX({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const update = () => {
      box.dataset.more = box.scrollLeft + box.clientWidth < box.scrollWidth - 1 ? "right" : "";
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(box);
    box.addEventListener("scroll", update, { passive: true });
    return () => {
      resize.disconnect();
      box.removeEventListener("scroll", update);
    };
  }, []);
  return (
    <div ref={ref} className={cx("relative overflow-x-auto data-[more=right]:mask-r-from-[calc(100%-3rem)]", className)}>
      {children}
    </div>
  );
}
