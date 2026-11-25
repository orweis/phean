import { describe, expect, it } from "vitest";

import {
  ANSWERED_TTL_MS,
  answeredEntry,
  answerReceipt,
  ARRIVAL_GUARD_MS,
  freshAnswered,
  isStaleRefusal,
  mayAct,
  requestOwningFile,
  DONE_TITLES,
  doneTitle,
  dragOffset,
  isSidewaysDrag,
  isVerticalDrag,
  picksLabel,
  progressSegments,
  progressText,
  quickOrder,
  starterChips,
  SWIPE_THRESHOLD,
  swipeIntent,
  swipeProgress,
  tiltOf,
  MAX_TILT,
} from "@/lib/quick-decisions";
import type { PipelineRequestRef } from "@/lib/agent-sessions";

const PIPELINE: PipelineRequestRef = { pipelineId: "p_1", pipelineName: "Newsletter", runId: "r_1", runNumber: 4, stopId: "review", stopName: "Review" };

const item = (id: string, askedAt: string, extra: { snoozedAt?: string; pipeline?: PipelineRequestRef } = {}) => ({ request: { id, askedAt, ...extra } });
const ids = (items: { request: { id: string } }[]) => items.map(({ request }) => request.id);

describe("the Quick Decisions queue", () => {
  it("puts pipeline decisions first, then the rest longest waiting first", () => {
    const queue = [item("a", "2026-11-20T09:00:00Z"), item("b", "2026-11-19T09:00:00Z"), item("p", "2026-11-21T09:00:00Z", { pipeline: PIPELINE })];
    expect(ids(quickOrder(queue))).toEqual(["p", "b", "a"]);
  });

  it("sends a snoozed request behind everything asked before it was snoozed, pinned or not", () => {
    const queue = [
      item("a", "2026-11-18T09:00:00Z", { snoozedAt: "2026-11-21T10:00:00Z" }),
      item("b", "2026-11-20T09:00:00Z"),
      item("p", "2026-11-19T09:00:00Z", { pipeline: PIPELINE, snoozedAt: "2026-11-21T09:00:00Z" }),
      item("c", "2026-11-22T09:00:00Z"),
    ];
    expect(ids(quickOrder(queue))).toEqual(["b", "p", "a", "c"]);
  });

  it("applies snoozes the server has not echoed yet", () => {
    const queue = [item("a", "2026-11-18T09:00:00Z"), item("b", "2026-11-19T09:00:00Z"), item("p", "2026-11-20T09:00:00Z", { pipeline: PIPELINE })];
    expect(ids(quickOrder(queue, { a: "2026-11-25T09:00:00Z", p: "2026-11-25T09:01:00Z" }))).toEqual(["b", "a", "p"]);
    // Equal times keep the server's order.
    expect(ids(quickOrder([item("x", "2026-11-18T09:00:00Z"), item("y", "2026-11-18T09:00:00Z")]))).toEqual(["x", "y"]);
  });
});

describe("swipes", () => {
  it("takes only a clearly sideways drag, and leaves up and down to the page", () => {
    expect(isSidewaysDrag(4, 0)).toBe(false);
    expect(isSidewaysDrag(30, 5)).toBe(true);
    expect(isSidewaysDrag(30, 25)).toBe(false);
    expect(isVerticalDrag(5, 30)).toBe(true);
    expect(isVerticalDrag(30, 5)).toBe(false);
    expect(isVerticalDrag(2, 4)).toBe(false);
  });

  it("acts past the threshold, sends only when there is something to send, and springs back short of it", () => {
    expect(SWIPE_THRESHOLD).toBe(110);
    expect(swipeIntent(109, true)).toBeNull();
    expect(swipeIntent(110, true)).toBe("send");
    expect(swipeIntent(200, false)).toBeNull();
    expect(swipeIntent(-109, true)).toBeNull();
    expect(swipeIntent(-110, false)).toBe("snooze");
  });

  it("follows the finger, gives only a little rightward with nothing to send, and tilts a little", () => {
    expect(dragOffset(80, true)).toBe(80);
    expect(dragOffset(-80, false)).toBe(-80);
    expect(dragOffset(40, false)).toBe(10);
    expect(dragOffset(400, false)).toBe(28);
    expect(tiltOf(0)).toBe(0);
    expect(tiltOf(48)).toBe(2);
    expect(tiltOf(1000)).toBe(MAX_TILT);
    expect(tiltOf(-1000)).toBe(-MAX_TILT);
    expect(swipeProgress(55)).toBe(0.5);
    expect(swipeProgress(-500)).toBe(1);
  });
});

describe("progress", () => {
  it("marks what was answered, the card on screen, and the rest", () => {
    expect(progressSegments(2, 3)).toEqual(["done", "done", "current", "rest", "rest"]);
    expect(progressSegments(0, 1)).toEqual(["current"]);
    expect(progressSegments(3, 0)).toEqual(["done", "done", "done"]);
    expect(progressSegments(0, 0)).toEqual([]);
  });

  it("says where the person is in words as well", () => {
    expect(progressText(2, 3)).toEqual({ count: "3 of 5", spoken: "Decision 3 of 5: 2 answered, 2 after this one" });
    expect(progressText(4, 0)).toEqual({ count: "4 of 4", spoken: "All 4 done" });
  });
});

describe("the words on the buttons", () => {
  it("names the picks a send button sends, or how many when they would not fit", () => {
    expect(picksLabel(["Blog", "Newsletter", "Changelog"], [0, 2])).toBe("Blog + Changelog");
    expect(picksLabel(["Blog", "Newsletter", "Changelog"], new Set([1]))).toBe("Newsletter");
    expect(picksLabel(["A very long channel name indeed", "Another very long channel"], [0, 1])).toBe("2 picks");
  });

  it("offers starters built on the options, or generic ones for a question", () => {
    expect(starterChips({ kind: "decision", options: ["Hold", "Send"] })).toEqual(["Hold, but ", "Send, but "]);
    expect(starterChips({ kind: "question", options: [] })).toHaveLength(3);
    expect(starterChips({ kind: "decision", options: [] })).toHaveLength(3);
  });

  it("says what was sent to whom, and that a pipeline's answer cannot be taken back", () => {
    expect(answerReceipt("Send", { agentName: "Claude" })).toBe("Sent “Send” to Claude");
    expect(answerReceipt("Hold", { agentName: "Phean", pipeline: PIPELINE })).toBe("Sent “Hold” to Newsletter #4; the run has it now, so it cannot be taken back");
  });

  it("picks a done title from the list for any random number", () => {
    expect(doneTitle(0)).toBe(DONE_TITLES[0]);
    expect(doneTitle(0.999)).toBe(DONE_TITLES[DONE_TITLES.length - 1]);
    expect(doneTitle(1)).toBe(DONE_TITLES[DONE_TITLES.length - 1]);
    expect(new Set(DONE_TITLES).size).toBe(5);
  });
});

describe("guarding against a second post", () => {
  it("acts once per request: never while one is on its way, never once it is settled here", () => {
    const none = new Set<string>();
    expect(mayAct("q_1", { inFlight: none, settled: none })).toBe(true);
    expect(mayAct("q_1", { inFlight: new Set(["q_1"]), settled: none })).toBe(false);
    expect(mayAct("q_1", { inFlight: none, settled: new Set(["q_1"]) })).toBe(false);
    expect(mayAct("q_2", { inFlight: new Set(["q_1"]), settled: new Set(["q_1"]) })).toBe(true);
  });

  it("holds a new card still for long enough to swallow a double tap", () => {
    expect(ARRIVAL_GUARD_MS).toBeGreaterThanOrEqual(250);
    expect(ARRIVAL_GUARD_MS).toBeLessThanOrEqual(500);
  });

  it("treats a conflict or a missing request as stale, and anything else as a mistake to show", () => {
    expect(isStaleRefusal("conflict")).toBe(true);
    expect(isStaleRefusal("not_found")).toBe(true);
    expect(isStaleRefusal("invalid")).toBe(false);
    expect(isStaleRefusal("forbidden")).toBe(false);
    expect(isStaleRefusal(undefined)).toBe(false);
  });
});

describe("the file a request may show", () => {
  const items = [
    { request: { id: "q_1" }, documents: [{ id: "d_1" }, { id: "d_2" }] },
    { request: { id: "q_2" }, documents: [{ id: "d_3" }] },
  ];

  it("is one on the request's own task", () => {
    expect(requestOwningFile(items, "q_1", "d_2")?.request.id).toBe("q_1");
  });

  it("is nothing for another task's document, a request that is gone, or a missing id", () => {
    expect(requestOwningFile(items, "q_1", "d_3")).toBeUndefined();
    expect(requestOwningFile(items, "q_9", "d_1")).toBeUndefined();
    expect(requestOwningFile(items, undefined, "d_1")).toBeUndefined();
    expect(requestOwningFile(items, "q_1", undefined)).toBeUndefined();
  });
});

describe("what the tab remembers", () => {
  const item = { taskId: "t_1", request: { id: "q_1", question: "Send the launch email to the beta list now, or hold it until the pricing page is live?" } };

  it("keeps ids and a short label, never the whole question or answer", () => {
    const entry = answeredEntry(item, "Hold it until Thursday, when the pricing page goes live and we can link it");
    expect(entry).toMatchObject({ requestId: "q_1", taskId: "t_1", undoable: true });
    expect(Object.keys(entry).sort()).toEqual(["label", "requestId", "taskId", "undoable"]);
    expect(entry.label.length).toBeLessThanOrEqual(90);
    expect(entry.label).not.toContain("pricing page is live?");
    expect(answeredEntry({ ...item, request: { ...item.request, pipeline: PIPELINE } }, "Hold").undoable).toBe(false);
  });

  it("forgets it after the time-to-live, and reads anything malformed as nothing", () => {
    const entries = [answeredEntry(item, "Hold")];
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(freshAnswered({ savedAt: now - 1000, entries }, now)).toEqual(entries);
    expect(freshAnswered({ savedAt: now - ANSWERED_TTL_MS - 1, entries }, now)).toEqual([]);
    expect(freshAnswered({ savedAt: now, entries: [{ requestId: "q_1", question: "old shape" }] }, now)).toEqual([]);
    expect(freshAnswered([{ requestId: "q_1" }], now)).toEqual([]);
    expect(freshAnswered(null, now)).toEqual([]);
  });
});
