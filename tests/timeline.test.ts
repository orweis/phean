import { describe, expect, it } from "vitest";

import type { TaskStatus } from "@/lib/domain";
import {
  buildJourneys,
  cumulativeFlow,
  daysBetween,
  fractionOf,
  parseTimelineDays,
  statusAt,
  timeWindow,
  trackOf,
  type JourneyTask,
  type TaskEventLike,
} from "@/lib/timeline";

const NOW = new Date("2026-03-15T12:00:00Z");
const day = (offset: number, hour = 9) => new Date(Date.UTC(2026, 2, 15 + offset, hour));

function task(id: string, status: TaskStatus, createdOffset: number, extra: Partial<JourneyTask> = {}): JourneyTask {
  return { id, status, createdAt: day(createdOffset), updatedAt: day(createdOffset), completedAt: null, ...extra };
}

const event = (entityId: string, action: string, offset: number, data: Record<string, unknown> = {}): TaskEventLike => ({
  entityId,
  action,
  createdAt: day(offset),
  data,
});

describe("time windows", () => {
  it("ends today, runs ahead for due dates, and is measured in UTC days", () => {
    const window = timeWindow(14, NOW, 7);
    expect(window.start.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-03-23T00:00:00.000Z");
    expect(window.days).toHaveLength(21);
    expect(fractionOf(window, new Date("2026-01-01T00:00:00Z"))).toBe(0);
    expect(fractionOf(window, new Date("2026-12-01T00:00:00Z"))).toBe(1);
    expect(fractionOf(window, new Date("2026-03-12T12:00:00Z"))).toBeCloseTo(10.5 / 21);
    expect(daysBetween(day(-3, 23), NOW)).toBe(3);
  });

  it("only accepts the offered windows", () => {
    expect(parseTimelineDays("30")).toBe(30);
    expect(parseTimelineDays("31")).toBe(14);
    expect(parseTimelineDays(undefined)).toBe(14);
  });
});

describe("journeys", () => {
  it("replays the activity log into the statuses a task held", () => {
    const [journey] = buildJourneys(
      [task("t1", "done", -6, { completedAt: day(-1), updatedAt: day(-1) })],
      [
        event("t1", "task.completed", -1),
        event("t1", "task.captured", -6, { status: "inbox" }),
        event("t1", "task.assigned", -5),
        event("t1", "task.claimed", -3),
      ],
    );
    expect(journey!.stops.map((stop) => [stop.status, stop.at.toISOString()])).toEqual([
      ["inbox", day(-6).toISOString()],
      ["todo", day(-5).toISOString()],
      ["in_progress", day(-3).toISOString()],
      ["done", day(-1).toISOString()],
    ]);
    expect(statusAt(journey!, day(-4))).toBe("todo");
    expect(statusAt(journey!, day(-7))).toBeUndefined();
  });

  it("follows status changes and releases", () => {
    const [journey] = buildJourneys(
      [task("t2", "dropped", -8, { updatedAt: day(-2) })],
      [
        event("t2", "task.captured", -8, { status: "todo" }),
        event("t2", "task.claimed", -6),
        event("t2", "task.released", -4),
        event("t2", "task.updated", -2, { changed: ["status"], status: "dropped" }),
      ],
    );
    expect(journey!.stops.map((stop) => stop.status)).toEqual(["todo", "in_progress", "todo", "dropped"]);
  });

  it("reconciles history logged before status changes were recorded", () => {
    const [journey] = buildJourneys(
      [task("t3", "in_progress", -5, { updatedAt: day(-2) })],
      [event("t3", "task.captured", -5), event("t3", "task.updated", -2, { changed: ["status"] })],
    );
    expect(journey!.stops.map((stop) => [stop.status, stop.at.toISOString()])).toEqual([
      ["inbox", day(-5).toISOString()],
      ["in_progress", day(-2).toISOString()],
    ]);
  });
});

describe("tracks and flow", () => {
  const window = timeWindow(7, NOW);
  const journeys = buildJourneys(
    [
      task("open", "in_progress", -10, { updatedAt: day(-2) }),
      task("arrived", "done", -4, { completedAt: day(-1), updatedAt: day(-1) }),
      task("old", "done", -30, { completedAt: day(-20), updatedAt: day(-3) }),
      task("dropped", "dropped", -3, { updatedAt: day(-2) }),
    ],
    [
      event("open", "task.captured", -10, { status: "todo" }),
      event("open", "task.claimed", -2),
      event("arrived", "task.captured", -4, { status: "inbox" }),
      event("arrived", "task.completed", -1),
      event("dropped", "task.captured", -3, { status: "inbox" }),
      event("dropped", "task.updated", -2, { status: "dropped" }),
    ],
  );

  it("draws open segments clipped to the window and ends the track at arrival", () => {
    const open = trackOf(journeys[0]!, window);
    expect(open.end).toEqual({ kind: "open" });
    expect(open.segments.map((segment) => segment.status)).toEqual(["todo", "in_progress"]);
    expect(open.segments[0]!.from).toBe(0);
    expect(open.segments[1]!.to).toBeCloseTo(fractionOf(window, NOW));

    const arrived = trackOf(journeys[1]!, window);
    expect(arrived.segments).toHaveLength(1);
    expect(arrived.end).toEqual({ kind: "arrived", at: fractionOf(window, day(-1)) });
    expect(trackOf(journeys[3]!, window).end.kind).toBe("dropped");
  });

  it("counts each station at the end of every day, and only arrivals inside the window", () => {
    const flow = cumulativeFlow(journeys, window);
    expect(flow).toHaveLength(7);
    expect(flow.at(-1)!.counts).toEqual({ inbox: 0, todo: 0, in_progress: 1, done: 1 });
    const threeDaysAgo = flow.find((point) => point.day.getTime() === Date.UTC(2026, 2, 12))!;
    expect(threeDaysAgo.counts).toEqual({ inbox: 2, todo: 1, in_progress: 0, done: 0 });
  });
});
