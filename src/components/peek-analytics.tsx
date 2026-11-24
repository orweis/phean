"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { track } from "@/lib/analytics";
import { isPeekPath, peekOrigin, type PeekOrigin } from "@/lib/peek-origin";

/** The page under any peek, kept as the person moves between workspace pages. */
let origin: PeekOrigin = "other";

/** In the workspace layout: remembers which page is on screen, so a task's peek can say what it opened over. */
export function PeekOriginTracker() {
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  useEffect(() => {
    if (!isPeekPath(pathname)) origin = peekOrigin(pathname, view);
  }, [pathname, view]);
  return null;
}

/** In the task peek: sends `task_peek_open` with the page it opened over. Key it by task, so each task opened counts once. */
export function TaskPeekOpened() {
  useEffect(() => {
    track("task_peek_open", { from: origin });
  }, []);
  return null;
}
