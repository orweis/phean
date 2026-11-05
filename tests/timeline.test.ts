import { describe, expect, it } from "vitest";

import { daysBetween } from "@/lib/dates";
import type { Priority, TaskStatus } from "@/lib/domain";
import {
  buildJourneys,
  cumulativeFlow,
  fitWindow,
  flowPlot,
  fractionOf,
  groupByGoal,
  journeyTotals,
  mostPressing,
  parseTimelineDays,
  statusAt,
  timeWindow,
  trackOf,
  windowSpan,
  type Journey,
  type JourneyTask,
  type PlannedTask,
  type TaskEventLike,
} from "@/lib/timeline";

const NOW = new Date("2026-03-15T12:00:00Z");
const day = (offset: number, hour = 9) => new Date(Date.UTC(2026, 2, 15 + offset, hour));

function task(id: string, status: TaskStatus, createdOffset: number, extra: Partial<JourneyTask> = {}): JourneyTask {
  return { id, status, createdAt: day(createdOffset), updatedAt: day(createdOffset), completedAt: null, ...extra };
}

function plannedTask(id: string, status: TaskStatus, extra: Partial<PlannedTask> = {}): PlannedTask {
  return { ...task(id, status, -2), priority: "medium", dueDate: null, goalId: null, ...extra };
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

  it("fits a window to a shorter history, but never under a week", () => {
    const requested = timeWindow(90, NOW, 7);
    const capturedOn = (offset: number) => buildJourneys([task(`t${offset}`, "inbox", offset)], []);

    const fitted = fitWindow(requested, capturedOn(-20));
    expect(fitted.start.toISOString()).toBe("2026-02-23T00:00:00.000Z");
    expect(fitted.end).toEqual(requested.end);
    expect(fitted.days).toHaveLength(21 + 7);

    expect(fitWindow(requested, capturedOn(-1)).days).toHaveLength(7 + 7);
    expect(fitWindow(requested, []).days).toHaveLength(7 + 7);
    expect(fitWindow(requested, capturedOn(-120))).toBe(requested);

    expect(windowSpan(fitted, 90)).toBe("since Feb 23");
    expect(windowSpan(requested, 90)).toBe("over the last 90 days");
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

  it("picks the most pressing open tracks and keeps them in the order they set out", () => {
    const track = (id: string, priority: Priority, dueDate: string | null, status: TaskStatus = "todo"): Journey<PlannedTask> => ({
      task: plannedTask(id, status, { priority, dueDate }),
      stops: [{ status, at: NOW }],
    });
    const tracks = [
      track("low", "low", null),
      track("late", "medium", "2026-03-10"),
      track("urgent", "urgent", null),
      track("finished", "urgent", null, "done"),
      track("soon", "medium", "2026-03-16"),
    ];
    expect(mostPressing(tracks, 3, NOW).map(({ task }) => task.id)).toEqual(["late", "urgent", "soon"]);
  });

  it("totals a window's journeys, counting only arrivals inside it", () => {
    const planned = buildJourneys(
      [
        plannedTask("late", "todo", { dueDate: "2026-03-10" }),
        plannedTask("open", "in_progress", { dueDate: "2026-03-15" }),
        plannedTask("arrived", "done", { completedAt: day(-1) }),
        plannedTask("old", "done", { completedAt: day(-30) }),
        plannedTask("dropped", "dropped"),
      ],
      [],
    );
    expect(journeyTotals(planned, window)).toEqual({ total: 5, done: 1, dropped: 1, open: 2, late: 1 });
  });

  it("groups journeys under their goals in tree order, with unfiled work last", () => {
    const planned = buildJourneys(
      [
        plannedTask("ops-task", "todo", { goalId: "g_ops" }),
        plannedTask("loose", "todo"),
        plannedTask("finance-task", "todo", { goalId: "g_finance" }),
        plannedTask("hidden-goal", "todo", { goalId: "g_not_shown" }),
      ],
      [],
    );
    const goals = [
      { id: "g_finance", title: "Finance" },
      { id: "g_empty", title: "Nothing here" },
      { id: "g_ops", title: "Ops" },
    ];
    expect(groupByGoal(planned, goals, "acme").map(({ key, title, href, journeys }) => [key, title, href, journeys.map(({ task }) => task.id)])).toEqual([
      ["g_finance", "Finance", "/w/acme/goals/g_finance", ["finance-task"]],
      ["g_ops", "Ops", "/w/acme/goals/g_ops", ["ops-task"]],
      ["unfiled", "Not filed under a goal", undefined, ["loose", "hidden-goal"]],
    ]);
  });

  it("counts each station at the end of every day, and only arrivals inside the window", () => {
    const flow = cumulativeFlow(journeys, window);
    expect(flow).toHaveLength(7);
    expect(flow.at(-1)!.counts).toEqual({ inbox: 0, todo: 0, in_progress: 1, done: 1 });
    const threeDaysAgo = flow.find((point) => point.day.getTime() === Date.UTC(2026, 2, 12))!;
    expect(threeDaysAgo.counts).toEqual({ inbox: 2, todo: 1, in_progress: 0, done: 0 });
  });

  it("places the flow on the timetable's axis: each day's end, now for today, and the week ahead left for the future", () => {
    const ahead = timeWindow(7, NOW, 7);
    const flow = cumulativeFlow(journeys, ahead);
    const plot = flowPlot(flow, ahead);
    expect(plot.xs).toHaveLength(flow.length);
    expect(plot.start).toBe(0);
    // The first point is the end of the first of 14 days; today's point is now itself.
    expect(plot.xs[0]).toBeCloseTo(1 / 14);
    expect(plot.xs.at(-1)).toBe(plot.now);
    expect(plot.now).toBeCloseTo(fractionOf(ahead, NOW));
    expect(plot.now).toBeLessThan(0.55);
    // Points only move forward along the axis.
    expect(plot.xs.every((x, index) => index === 0 || x > plot.xs[index - 1]!)).toBe(true);
  });

  it("marks a group with its goal's status, so proposed work can be told from committed work", () => {
    const planned = buildJourneys([plannedTask("lease", "todo", { goalId: "g_lease" })], []);
    const [group] = groupByGoal(planned, [{ id: "g_lease", title: "Renew the office lease", status: "proposed" }], "acme");
    expect(group).toMatchObject({ key: "g_lease", status: "proposed" });
  });
});
