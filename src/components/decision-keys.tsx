"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

/** Typing into a field must never pick an option; a tick box is not typing. */
const TYPING = "input:not([type=checkbox]), textarea, select, [contenteditable]";

const entriesOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[data-entry]")];

/** Marks one entry selected and clears the rest; returns where it stands in the list. */
function markSelected(root: HTMLElement, entry: HTMLElement): number {
  for (const other of root.querySelectorAll<HTMLElement>("[data-entry][data-selected]")) {
    if (other === entry) continue;
    delete other.dataset.selected;
    other.removeAttribute("aria-current");
  }
  if (!entry.hasAttribute("data-selected")) {
    entry.dataset.selected = "";
    entry.setAttribute("aria-current", "true");
  }
  return Math.max(0, entriesOf(root).indexOf(entry));
}

/**
 * Keyboard answering for a list of requests. One entry is always selected while the list has any,
 * marked unmistakably (`data-selected`, an accent bar and tint, `aria-current`) and kept in view:
 * the first on arrival, then the one last focused or clicked, and, when an answered entry leaves,
 * the one that takes its place. While an entry is selected, 1 to 9 choose its options (or tick
 * them, where several may be picked, and Enter sends), J and K move to the next and previous
 * entry, and Enter opens its task. Each option shows its number and
 * names it in `aria-keyshortcuts`; Undo in the status region makes a mistaken key cheap.
 */
export function DecisionKeys({ children }: { children: ReactNode }) {
  const router = useRouter();
  const list = useRef<HTMLDivElement>(null);

  /** Where the selected entry stood, so the one that takes its place inherits the selection. */
  const position = useRef(0);

  const select = (entry: HTMLElement) => {
    if (list.current) position.current = markSelected(list.current, entry);
  };

  useEffect(() => {
    const root = list.current;
    if (!root) return;
    /** Focus that fell out of the page (its entry was answered and left) has nowhere to be. */
    const focusLost = () => !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
    const keepSelection = () => {
      if (root.querySelector("[data-entry][data-selected]")) return;
      const all = entriesOf(root);
      const next = all[Math.min(position.current, all.length - 1)];
      if (!next) return;
      position.current = markSelected(root, next);
      if (focusLost()) next.focus({ preventScroll: true });
    };
    // An entry may have taken focus before the page finished loading; mark it, or else the first.
    const focused = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>("[data-entry]");
    if (focused && root.contains(focused)) position.current = markSelected(root, focused);
    else keepSelection();
    const observer = new MutationObserver(keepSelection);
    observer.observe(root, { childList: true, subtree: true });
    // With focus nowhere (the page just loaded, or a click on empty space), J and K still move from
    // the selected entry. Numbers wait for focus, so a stray key on arrival answers nothing.
    const onDocumentKey = (event: globalThis.KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || !focusLost()) return;
      if (!/^[jk]$/i.test(event.key)) return;
      const selected = root.querySelector<HTMLElement>("[data-entry][data-selected]");
      if (!selected) return;
      selected.focus({ preventScroll: true });
      selected.dispatchEvent(new globalThis.KeyboardEvent("keydown", { key: event.key, bubbles: true, cancelable: true }));
      event.preventDefault();
    };
    document.addEventListener("keydown", onDocumentKey);
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onDocumentKey);
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest(TYPING) || target.closest("details[open]")) return;
    const entry = target.closest<HTMLElement>("[data-entry]");
    if (!entry) return;
    const key = event.key.toLowerCase();
    if (/^[1-9]$/.test(key)) {
      const option = entry.querySelector<HTMLButtonElement | HTMLInputElement>(`[data-option="${key}"]:not(:disabled)`);
      if (!option) return;
      event.preventDefault();
      option.click();
      // A tick box keeps focus, so Enter sends the picks from there.
      if (option.type === "checkbox") option.focus({ preventScroll: true });
      return;
    }
    // Enter on a tick box sends the picks of a request that takes several.
    if (key === "enter" && target.matches("input[type=checkbox][data-option]")) {
      const form = target.closest("form");
      if (!form?.querySelector("input[data-option]:checked")) return;
      event.preventDefault();
      form.requestSubmit();
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
      // Safari does not focus a button on click, so a click marks its entry itself.
      onPointerDown={(event) => {
        const entry = (event.target as HTMLElement).closest<HTMLElement>("[data-entry]");
        if (entry) select(entry);
      }}
    >
      {children}
    </div>
  );
}
