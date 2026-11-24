import type { EventParams } from "./analytics";

export type PeekOrigin = NonNullable<EventParams<"task_peek_open">["from"]>;

const LAYOUTS = new Set(["table", "calendar", "map"]);

/**
 * Which page a task's peek opened over, for `task_peek_open`'s `from`: the Tasks page's layout (its
 * `?view=`, the board when none), Search, Decisions or Goals, else `other`. Client-safe and pure.
 */
export function peekOrigin(pathname: string, view: string | null | undefined): PeekOrigin {
  const rest = pathname.replace(/^\/w\/[^/]+/, "");
  if (rest === "/board") return view && LAYOUTS.has(view) ? (view as PeekOrigin) : "board";
  if (rest === "/search") return "search";
  if (rest === "/decisions") return "decisions";
  if (rest === "/goals" || rest.startsWith("/goals/")) return "goals";
  return "other";
}

/** Whether a path is itself a peek (a task or document opened over a page), which is never an origin. */
export function isPeekPath(pathname: string): boolean {
  return /^\/w\/[^/]+\/(tasks|documents)\/[^/]+/.test(pathname);
}
