"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import { cx } from "@/lib/cx";

/** The chip a rail has selected: a link to the current page, or a selected tab. */
const SELECTED = '[aria-current="page"], [aria-current="true"], [aria-selected="true"]';

/**
 * Keeps a sideways rail of chips honest on a narrow screen: marks which edges have more beyond them
 * (`data-more` "left", "right" or both, which the `chip-rail` utility fades), and brings the
 * selected chip to the middle whenever `selected` changes, so the chip you picked is the one you
 * see. It scrolls the rail alone, never the page.
 */
export function useChipRail(ref: RefObject<HTMLElement | null>, selected: unknown) {
  useEffect(() => {
    const rail = ref.current;
    if (!rail) return;
    const update = () => {
      const more = [rail.scrollLeft > 1 && "left", rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1 && "right"].filter(Boolean).join(" ");
      if (rail.dataset.more !== more) rail.dataset.more = more;
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(rail);
    rail.addEventListener("scroll", update, { passive: true });
    return () => {
      resize.disconnect();
      rail.removeEventListener("scroll", update);
    };
  }, [ref]);

  useEffect(() => {
    const rail = ref.current;
    const chip = rail?.querySelector<HTMLElement>(SELECTED);
    if (!rail || !chip || rail.scrollWidth <= rail.clientWidth) return;
    const box = rail.getBoundingClientRect();
    const at = chip.getBoundingClientRect();
    const left = rail.scrollLeft + at.left - box.left - (box.width - at.width) / 2;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: Math.max(0, left), behavior: still || !rail.dataset.centred ? "instant" : "smooth" });
    rail.dataset.centred = "1";
  }, [ref, selected]);
}

/**
 * A `nav` of chips that scrolls sideways on a narrow screen with no scrollbar, fading at an edge
 * while more lies beyond it, and keeping the selected chip (`aria-current`) in the middle.
 */
export function ChipRail({ label, selected, className, children }: { label: string; selected: unknown; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useChipRail(ref, selected);
  return (
    <nav ref={ref} aria-label={label} className={cx("chip-rail", className)}>
      {children}
    </nav>
  );
}
