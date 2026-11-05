"use client";

import type { KeyboardEvent, ReactNode } from "react";

/** Typing into a field must never pick an option. */
const TYPING = "input, textarea, select, [contenteditable]";

/**
 * Keyboard answering for a list of requests: while an entry holds focus, 1 to 9 choose its
 * options and J and K move to the next and previous entry. Each option shows its number and
 * names it in `aria-keyshortcuts`; Undo in the status region makes a mistaken key cheap.
 */
export function DecisionKeys({ children }: { children: ReactNode }) {
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
    if (key !== "j" && key !== "k") return;
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-entry]")];
    const next = entries[entries.indexOf(entry) + (key === "j" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
  return <div onKeyDown={onKeyDown}>{children}</div>;
}
