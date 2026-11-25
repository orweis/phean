"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import type { ReactNode } from "react";

import { isFocusedFlow } from "@/lib/quick-decisions";

import { KeyboardShortcuts } from "./keyboard-shortcuts";

/**
 * The workspace's frame around a page: the header and tab rail (`chrome`) over the page's `main`.
 * A focused flow (Quick Decisions) leaves the chrome out and gets the whole screen, inside the
 * safe-area insets, clipping a card flown off its side rather than scrolling sideways. It keeps the
 * `?` legend, which otherwise lives in the header. The status region, the skip link and the peek
 * slot stay with the layout, so they work the same on every page.
 */
export function WorkspaceFrame({ chrome, children }: { chrome: ReactNode; children: ReactNode }) {
  const focused = isFocusedFlow(useSelectedLayoutSegments());
  return (
    <>
      {focused ? <KeyboardShortcuts /> : chrome}
      <main
        id="content"
        tabIndex={-1}
        data-focused-flow={focused || undefined}
        className={
          focused
            ? "flex min-h-dvh flex-col overflow-x-clip pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] outline-none"
            : "mx-auto max-w-7xl px-4 py-6 outline-none sm:px-6 sm:py-8"
        }
      >
        {children}
      </main>
    </>
  );
}
