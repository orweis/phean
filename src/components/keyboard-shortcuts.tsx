"use client";

import { Keyboard, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { buttonClasses } from "./ui/button";

/** Asks the legend to open, from anywhere (the account menu's entry, say). */
export const OPEN_SHORTCUTS_EVENT = "phean:shortcuts";

const TYPING = "input, textarea, select, [contenteditable]";

const GROUPS = [
  {
    title: "Anywhere",
    keys: [
      { keys: ["?"], what: "Show these shortcuts" },
      { keys: ["/"], what: "Search: the page's own search box, or the Search tab" },
      { keys: ["Tab"], what: "First stop: skip past the header to the page" },
      { keys: ["Esc"], what: "Close the open panel or menu" },
    ],
  },
  {
    title: "Decisions and the overview",
    keys: [
      { keys: ["1", "–", "9"], what: "Pick the selected request's option" },
      { keys: ["Enter"], what: "Send the ticked options, where a request takes several" },
      { keys: ["J"], what: "Next request" },
      { keys: ["K"], what: "Previous request" },
    ],
  },
  {
    title: "Board",
    keys: [{ keys: ["Tab"], what: "In a lane's header: skip to the next lane" }],
  },
] as const;

/**
 * The legend of keyboard shortcuts, a glass sheet over the page: `?` opens it from anywhere
 * except a field, and Escape or a click outside closes it.
 */
export function KeyboardShortcuts() {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const open = () => {
      if (!dialog.current?.open) dialog.current?.showModal();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if ((event.target as Element | null)?.closest?.(TYPING)) return;
      event.preventDefault();
      open();
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, open);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, open);
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="shortcuts-title"
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      className="glass-float m-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-xl p-0 text-ink backdrop:bg-ink/20 motion-safe:animate-glass-in"
    >
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="shortcuts-title" className="flex items-center gap-2 text-md font-semibold">
            <Keyboard className="size-4 text-muted" aria-hidden />
            Keyboard shortcuts
          </h2>
          <button type="button" aria-label="Close" autoFocus className={buttonClasses("ghost", "sm", "px-2")} onClick={() => dialog.current?.close()}>
            <X aria-hidden />
          </button>
        </div>
        <div className="space-y-4">
          {GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="text-xs font-semibold text-ink-2">{group.title}</h3>
              <dl className="mt-1.5 divide-y divide-rule">
                {group.keys.map(({ keys, what }) => (
                  <div key={what} className="flex items-center justify-between gap-4 py-1.5">
                    <dt className="text-sm text-ink">{what}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {keys.map((key) =>
                        key === "–" ? (
                          <span key={key} className="text-xs text-muted">
                            to
                          </span>
                        ) : (
                          <kbd key={key} className="inline-flex h-6 min-w-6 items-center justify-center rounded-xs border border-rule bg-panel px-1.5 font-sans text-xs font-semibold text-ink-2">
                            {key}
                          </kbd>
                        ),
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}

/** The account menu's way to the legend, for people who do not know about `?`. */
export function ShortcutsButton() {
  return (
    <button type="button" className={buttonClasses("ghost", "menu")} onClick={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))}>
      <Keyboard aria-hidden />
      Keyboard shortcuts
      <kbd aria-hidden className="ml-auto rounded-xs border border-rule px-1 font-sans text-2xs text-muted">
        ?
      </kbd>
    </button>
  );
}
