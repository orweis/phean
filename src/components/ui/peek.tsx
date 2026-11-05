"use client";

import { ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "@/lib/cx";

import { buttonClasses } from "./button";

interface PeekProps {
  /** Names the dialog for screen readers; the content's own heading is what people read. */
  label: string;
  /**
   * "side" keeps the page in view beside the sheet (a task over its board); "center" gives reading
   * room (a document).
   */
  layout: "side" | "center";
  /** The item's own page, for the "Open as page" link: a full load, which a peek never intercepts. */
  pageHref: string;
  children: ReactNode;
}

/**
 * A focused view of one item over the page it was opened from: a native modal dialog, so the page
 * behind is inert, focus moves in and is trapped, and Escape closes it. Closing goes back in
 * history, which is also what the browser's Back does, and the item keeps its own URL, so a
 * refresh or a shared link opens its full page. It can grow to fill the screen. On phones it is
 * always the whole screen.
 */
export function Peek({ label, layout, pageHref, children }: PeekProps) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // What opened the peek (a card's title, a document chip) gets focus back when it closes. The page
    // may have re-rendered meanwhile, so it is found again by the link that leads here.
    const path = new URL(pageHref, window.location.origin).pathname;
    return () => {
      const opener = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].find((link) => link.pathname === path && !link.closest("dialog"));
      opener?.focus({ preventScroll: true });
    };
  }, [pageHref]);

  const close = () => router.back();

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      data-peek={layout}
      data-full={full || undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      className={cx(
        "m-0 flex max-h-none max-w-none flex-col overflow-hidden border border-rule bg-paper p-0 text-ink shadow-float outline-none backdrop:bg-ink/25 motion-safe:animate-glass-in",
        "max-sm:inset-0 max-sm:h-dvh max-sm:w-screen max-sm:rounded-none max-sm:border-0",
        full
          ? "inset-0 h-dvh w-screen rounded-none border-0"
          : layout === "side"
            ? "sm:inset-y-3 sm:right-3 sm:left-auto sm:h-[calc(100dvh-1.5rem)] sm:w-[min(44rem,calc(100vw-1.5rem))] sm:rounded-xl"
            : "sm:inset-0 sm:m-auto sm:h-[min(56rem,calc(100dvh-3rem))] sm:w-[min(64rem,calc(100vw-3rem))] sm:rounded-xl",
      )}
    >
      <div className="glass-bar flex shrink-0 items-center justify-end gap-1 px-3 py-2">
        <a href={pageHref} className={buttonClasses("ghost", "sm")}>
          <ExternalLink aria-hidden />
          Open as page
        </a>
        <button
          type="button"
          aria-pressed={full}
          className={cx(buttonClasses("ghost", "sm"), "max-sm:hidden")}
          onClick={() => setFull((value) => !value)}
        >
          {full ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          {full ? "Exit full screen" : "Full screen"}
        </button>
        <button type="button" aria-label="Close" autoFocus className={buttonClasses("ghost", "sm", "px-2")} onClick={close}>
          <X aria-hidden />
        </button>
      </div>
      <div className={cx("min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-8 sm:px-8", full && layout === "center" && "mx-auto w-full max-w-5xl")}>{children}</div>
    </dialog>
  );
}
