"use client";

import { useEffect } from "react";

/**
 * Brings the element a link pointed at (`data-focused` with this id) into view and gives it focus,
 * so a link to one decision or memory lands on it, not on the top of a long page.
 */
export function FocusOnLoad({ id }: { id: string | undefined }) {
  useEffect(() => {
    if (!id) return;
    const target = document.querySelector<HTMLElement>(`[data-focused="${CSS.escape(id)}"]`);
    if (!target) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: still ? "instant" : "smooth" });
    target.focus({ preventScroll: true });
  }, [id]);
  return null;
}
