/**
 * Quick Decisions: the Decisions queue one card at a time, for a phone. The pure parts live here (the
 * order of the queue, what a swipe means, the progress bar, the words on the buttons) so they are
 * unit tested; `components/quick-decisions` lays them out. Client-safe.
 */
import type { InputRequest } from "./agent-sessions";
import { queuedAt } from "./agent-sessions";
import type { DocumentRef } from "./documents";
import { truncate } from "./format";
import { runLabel } from "./pipelines";

/** One open request as Quick Decisions draws it: the request, and the words the server worked out for it. */
export interface QuickItem {
  taskId: string;
  /** The task's title, for the full context's heading. */
  title: string;
  request: InputRequest;
  /** Who asked, as people read it (`askerName`). */
  asker: string;
  /** The goal it serves, or the app it was asked in, when there is one. */
  where: string | null;
  /** "2 hours ago", worked out on the server so the page hydrates with the same words. */
  age: string;
  documents: DocumentRef[];
  /** For a decision a pipeline asked: the run, the stop, and its time limit. */
  pipeline: {
    /** "Weekly newsletter #42 · Review". */
    label: string;
    /** "Stop 3 of 5". */
    position: string | null;
    /** "Defaults to “Hold” in 6 hours", or what happens at the limit when there is no default. */
    timeLimit: string | null;
    /** What each option leads to. */
    steps: { option: string; next: string }[];
  } | null;
}

/** How far a card must travel sideways, in CSS pixels, before letting go acts; short of it the card springs back. */
export const SWIPE_THRESHOLD = 110;

/** Movement under this many pixels is a tap, not a drag. */
export const DRAG_SLOP = 10;

/** The most a card tilts while dragged, in degrees. */
export const MAX_TILT = 8;

/** The views of a request on the Quick Decisions page, held in the URL (`?view=`). */
export const QUICK_VIEWS = ["card", "context", "file"] as const;
export type QuickView = (typeof QUICK_VIEWS)[number];

/** The full context's tabs (`?tab=`). */
export const CONTEXT_TABS = ["context", "files", "links"] as const;
export type ContextTab = (typeof CONTEXT_TABS)[number];

/** Where Quick Decisions was opened from, for `quick_decisions_open` (`?from=`). */
export const QUICK_ENTRIES = ["button", "phone", "link"] as const;
export type QuickEntry = (typeof QUICK_ENTRIES)[number];

type Queued = Pick<InputRequest, "id" | "askedAt" | "snoozedAt" | "pipeline">;

/**
 * The queue in the order the cards come: pipeline decisions first (each holds a run until someone
 * answers), then the rest longest waiting first, as the Decisions page orders them
 * (`requestQueueOrder`). A snoozed request waits behind everything asked before it was snoozed,
 * pinned or not. `snoozed` overlays snoozes made on this page that the server has not echoed yet.
 */
export function quickOrder<T extends { request: Queued }>(items: readonly T[], snoozed: Readonly<Record<string, string>> = {}): T[] {
  const at = (item: T) => {
    const snoozedAt = snoozed[item.request.id] ?? item.request.snoozedAt;
    return { pinned: Boolean(item.request.pipeline) && !snoozedAt, queued: queuedAt({ askedAt: item.request.askedAt, snoozedAt }) };
  };
  return items
    .map((item, index) => ({ item, index, ...at(item) }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.queued.localeCompare(b.queued) || a.index - b.index)
    .map(({ item }) => item);
}

/** Whether a drag that has moved `dx`, `dy` is clearly sideways, so the card takes it rather than the page's scroll. */
export function isSidewaysDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_SLOP && Math.abs(dx) > Math.abs(dy) * 1.5;
}

/** Whether a drag has clearly gone up or down: the page scrolls, and the card stays put. */
export function isVerticalDrag(dx: number, dy: number): boolean {
  return Math.abs(dy) > DRAG_SLOP && Math.abs(dy) >= Math.abs(dx);
}

/** What letting go of a card dragged `dx` pixels does: send (right, when there is something to send), snooze (left), or nothing. */
export function swipeIntent(dx: number, canSend: boolean, threshold = SWIPE_THRESHOLD): "send" | "snooze" | null {
  if (dx >= threshold) return canSend ? "send" : null;
  if (dx <= -threshold) return "snooze";
  return null;
}

/** The card's tilt while dragged, in degrees: a little, growing with the distance, the same either way. */
export function tiltOf(dx: number): number {
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, dx / 24));
}

/** How far the drag is toward acting, from 0 to 1. */
export function swipeProgress(dx: number, threshold = SWIPE_THRESHOLD): number {
  return Math.min(1, Math.abs(dx) / threshold);
}

/** Whether letting go now would act (or, rightward with nothing to send, would have): the drag is past the threshold. */
export function isArmed(dx: number, threshold = SWIPE_THRESHOLD): boolean {
  return Math.abs(dx) >= threshold;
}

/**
 * How strongly the words behind the card show, from 0 to 1: legible from the first few pixels,
 * stronger as the card nears the threshold, and full once letting go would act.
 */
export function hintOpacity(dx: number, threshold = SWIPE_THRESHOLD): number {
  if (dx === 0) return 0;
  return isArmed(dx, threshold) ? 1 : 0.4 + 0.5 * swipeProgress(dx, threshold);
}

/**
 * Whether a page is a focused flow, which takes the whole screen without the workspace's header and
 * tab rail: Quick Decisions. `segments` are the route's segments below the workspace's layout.
 */
export function isFocusedFlow(segments: readonly string[]): boolean {
  return segments[0] === "decisions" && segments[1] === "quick";
}

/** Each segment of the progress bar: answered this session, the card on screen, and those still to come. */
export function progressSegments(answered: number, remaining: number): ("done" | "current" | "rest")[] {
  return [...Array<"done">(answered).fill("done"), ...(remaining > 0 ? (["current"] as const) : []), ...Array<"rest">(Math.max(0, remaining - 1)).fill("rest")];
}

/**
 * "3 of 7 requests" and its words for a screen reader: where the person is in today's queue. The
 * queue counts requests alone; goals waiting for approval are on the Decisions page.
 */
export function progressText(answered: number, remaining: number): { count: string; spoken: string } {
  const total = answered + remaining;
  const noun = total === 1 ? "request" : "requests";
  if (remaining === 0) return { count: `${answered} of ${total} ${noun}`, spoken: `All ${total} ${noun} done` };
  return {
    count: `${answered + 1} of ${total} ${noun}`,
    spoken: `Request ${answered + 1} of ${total}: ${answered} answered, ${remaining - 1} after this one`,
  };
}

/** Whether every request left is one snoozed in this visit: the queue has come round to them, so it rests. */
export function onlySnoozedLeft(queue: readonly { request: { id: string } }[], snoozedHere: Readonly<Record<string, string>>): boolean {
  return queue.length > 0 && queue.every((item) => item.request.id in snoozedHere);
}

/** "1 snoozed, nothing else waiting": the end of the queue when only snoozed requests are left. */
export function snoozedTitle(count: number): string {
  return `${count} snoozed, nothing else waiting`;
}

/** What the end of the queue says about goals waiting for approval, which the queue does not hold; null when there are none. */
export function approvalsLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 goal still needs your approval" : `${count} goals still need your approval`;
}

/** The send button for a request that takes several, by how many are ticked: "Send 3 picks". */
export function sendPicksLabel(count: number): string {
  return count === 0 ? "Pick at least one" : `Send ${count} ${count === 1 ? "pick" : "picks"}`;
}

/** The picks named on a send button: "Blog + Changelog", or how many when they would not fit. */
export function picksLabel(options: readonly string[], picks: ReadonlySet<number> | readonly number[], max = 40): string {
  const chosen = options.filter((_, index) => (picks instanceof Set ? picks.has(index) : (picks as readonly number[]).includes(index)));
  const joined = chosen.join(" + ");
  return joined.length <= max ? joined : `${chosen.length} picks`;
}

/** Starter phrases for the composer: an option with a condition, or a few generic openings for a question. */
export function starterChips(request: Pick<InputRequest, "options" | "kind">): string[] {
  if (request.options.length) return request.options.slice(0, 4).map((option) => `${option}, but `);
  return request.kind === "decision" ? ["Yes, go ahead", "No, hold off", "Not yet: "] : ["I don't know yet", "Ask me again tomorrow", "Check with "];
}

/**
 * What the status region says once an answer is sent, the receipt a person checks: on the Decisions
 * page and in Quick Decisions alike. A pipeline acts on its answer at once, so it says so.
 */
export function answerReceipt(answer: string, request: Pick<InputRequest, "agentName" | "pipeline">): string {
  return request.pipeline
    ? `Sent “${truncate(answer, 60)}” to ${runLabel({ name: request.pipeline.runName, number: request.pipeline.runNumber }, request.pipeline.pipelineName)}; the run has it now, so it cannot be taken back`
    : `Sent “${truncate(answer, 60)}” to ${request.agentName}`;
}

/** What the done screen says when the queue is empty; one is picked at random on the server. */
export const DONE_TITLES = [
  "You’re the King of decisions! 👑",
  "Done! Time to relax ☕",
  "Inbox zero, decision edition 🎉",
  "Every agent is unblocked. Nice work! 🚀",
  "All clear. Go stretch your legs 🌿",
] as const;

/** One of `DONE_TITLES`, from a random number in [0, 1). */
export function doneTitle(random: number): (typeof DONE_TITLES)[number] {
  return DONE_TITLES[Math.min(DONE_TITLES.length - 1, Math.max(0, Math.floor(random * DONE_TITLES.length)))]!;
}

/**
 * How long a card that has just arrived ignores taps, keys and swipes, in milliseconds: a double tap
 * or a held key meant for the card that left must never answer the one that replaced it.
 */
export const ARRIVAL_GUARD_MS = 300;

/** Whether a failed answer or snooze means the request is no longer there to act on (answered elsewhere, or gone). */
export const isStaleRefusal = (code: string | undefined): boolean => code === "conflict" || code === "not_found";

/**
 * Whether a request may be answered or snoozed now: never twice at once, never once it is settled
 * here, so a tap during the fly-off or a second key press posts nothing.
 */
export function mayAct(requestId: string, busy: { inFlight: ReadonlySet<string>; settled: ReadonlySet<string> }): boolean {
  return !busy.inFlight.has(requestId) && !busy.settled.has(requestId);
}

/**
 * The request a file view may show a file for: one still waiting whose task carries that file.
 * Anything else (another task's document, a request that is gone) shows nothing.
 */
export function requestOwningFile<T extends { request: { id: string }; documents: readonly { id: string }[] }>(
  items: readonly T[],
  requestId: string | undefined,
  fileId: string | undefined,
): T | undefined {
  if (!requestId || !fileId) return undefined;
  return items.find((item) => item.request.id === requestId && item.documents.some((document) => document.id === fileId));
}

/** What this tab remembers of an answer it gave, for the progress count and the done screen: ids and a short label, never the full words. */
export interface AnsweredEntry {
  requestId: string;
  taskId: string;
  /** “Hold” · Send the launch email…: the answer and the question, cut short. */
  label: string;
  /** A pipeline acts on its answer at once, so it cannot be taken back. */
  undoable: boolean;
}

/** How long this tab keeps what it answered: past it, the count starts again. */
export const ANSWERED_TTL_MS = 12 * 60 * 60 * 1000;

/** The entry kept for an answer: the request's ids and a label cut to a few words. */
export function answeredEntry(item: { taskId: string; request: Pick<InputRequest, "id" | "question" | "pipeline"> }, answer: string): AnsweredEntry {
  return { requestId: item.request.id, taskId: item.taskId, label: `“${truncate(answer, 30)}” · ${truncate(item.request.question, 50)}`, undoable: !item.request.pipeline };
}

/** What was stored, if it is still fresh and well formed; anything else reads as nothing answered. */
export function freshAnswered(stored: unknown, now: number): AnsweredEntry[] {
  const record = stored as { savedAt?: unknown; entries?: unknown } | null;
  if (typeof record !== "object" || record === null || typeof record.savedAt !== "number" || !Array.isArray(record.entries)) return [];
  if (now - record.savedAt > ANSWERED_TTL_MS || record.savedAt > now + 60_000) return [];
  return record.entries.filter((entry): entry is AnsweredEntry => {
    const value = entry as Partial<AnsweredEntry> | null;
    return typeof value === "object" && value !== null && [value.requestId, value.taskId, value.label].every((field) => typeof field === "string") && typeof value.undoable === "boolean";
  });
}
