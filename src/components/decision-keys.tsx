"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

/** Typing into a field must never pick an option. */
const TYPING = "input, textarea, select, [contenteditable]";

/**
 * Keyboard answering for a list of requests. The entry holding focus is the selected one, marked
 * unmistakably (`data-selected`, an accent bar and tint, `aria-current`) and kept in view. While
 * an entry is selected, 1 to 9 choose its options, J and K move to the next and previous entry,
 * and Enter opens its task. Each option shows its number and names it in `aria-keyshortcuts`;
 * Undo in the status region makes a mistaken key cheap.
 */
export function DecisionKeys({ children }: { children: ReactNode }) {
  const router = useRouter();
  const list = useRef<HTMLDivElement>(null);

  const select = (entry: HTMLElement) => {
    for (const other of list.current?.querySelectorAll<HTMLElement>("[data-entry][data-selected]") ?? []) {
      if (other === entry) continue;
      delete other.dataset.selected;
      other.removeAttribute("aria-current");
    }
    entry.dataset.selected = "";
    entry.setAttribute("aria-current", "true");
  };

  // An entry may have taken focus before the page finished loading; mark it once the list can.
  useEffect(() => {
    const entry = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>("[data-entry]");
    if (entry && list.current?.contains(entry)) select(entry);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest(TYPING) || target.closest("details[open]")) return;
    const entry = target.closest<HTMLElement>("[data-entry]");
    if (!entry) return;
    const key = event.key.toLowerCase();
    if (/^[1-9]$/.test(key)) {
      const option = entry.querySelector<HTMLButtonElement>(`[data-option="${key}"]:not(:disabled)`);
      if (!option) return;
      event.preventDefault();
      option.click();
      return;
    }
    if (key === "enter" && target === entry) {
      const link = entry.querySelector<HTMLAnchorElement>("a[data-task-link]");
      if (!link) return;
      event.preventDefault();
      router.push(link.getAttribute("href")!, { scroll: false });
      return;
    }
    if (key !== "j" && key !== "k") return;
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-entry]")];
    const next = entries[entries.indexOf(entry) + (key === "j" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  return (
    <div
      ref={list}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const entry = (event.target as HTMLElement).closest<HTMLElement>("[data-entry]");
        if (entry) select(entry);
      }}
    >
      {children}
    </div>
  );
}
