/**
 * Pure geometry and history for the timeline views: where each task stood over time
 * (its journey), the segments a track draws, and the cumulative flow of work per day.
 * Client-safe; every date is a UTC calendar day, matching how due dates are compared.
 */
import { isOpenTaskStatus, TASK_STATUSES, type TaskStatus } from "./domain";

const DAY_MS = 86_400_000;

/** The stations a task passes through, in chart order; "dropped" is an end, not a station. */
export const STATIONS = ["inbox", "todo", "in_progress", "done"] as const satisfies readonly TaskStatus[];
export type Station = (typeof STATIONS)[number];

export const TIMELINE_WINDOWS = [14, 30, 90] as const;
export type TimelineDays = (typeof TIMELINE_WINDOWS)[number];
/** Days after today the timetable shows, so upcoming due dates are on the chart. */
export const TIMELINE_AHEAD_DAYS = 7;

export function parseTimelineDays(value: string | undefined): TimelineDays {
  const days = Number(value);
  return (TIMELINE_WINDOWS as readonly number[]).includes(days) ? (days as TimelineDays) : 14;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Parses a YYYY-MM-DD due date as the start of that UTC day. */
export function dayOf(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export interface TimeWindow {
  /** Midnight UTC of the first day shown. */
  start: Date;
  /** Midnight UTC after the last day shown. */
  end: Date;
  now: Date;
  /** Midnight UTC of every day in the window. */
  days: Date[];
}

/** `days` days ending today, plus `ahead` days after today for upcoming due dates. */
export function timeWindow(days: number, now: Date, ahead = 0): TimeWindow {
  const today = startOfUtcDay(now);
  const start = addDays(today, -(days - 1));
  const end = addDays(today, ahead + 1);
  const count = days + ahead;
  return { start, end, now, days: Array.from({ length: count }, (_, index) => addDays(start, index)) };
}

/** Position of a moment in the window as a fraction from 0 (start) to 1 (end), clamped. */
export function fractionOf(window: TimeWindow, date: Date): number {
  const span = window.end.getTime() - window.start.getTime();
  return Math.min(1, Math.max(0, (date.getTime() - window.start.getTime()) / span));
}

export interface Stop {
  status: TaskStatus;
  at: Date;
}

export interface JourneyTask {
  id: string;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface TaskEventLike {
  entityId: string;
  action: string;
  createdAt: Date;
  data: Record<string, unknown>;
}

export interface Journey<T extends JourneyTask = JourneyTask> {
  task: T;
  /** Every status the task held, oldest first; the first stop is its capture. */
  stops: Stop[];
}

const isStatus = (value: unknown): value is TaskStatus => (TASK_STATUSES as readonly unknown[]).includes(value);

/** The status a task moves to after one of its logged events. */
function statusAfter(current: TaskStatus, event: TaskEventLike): TaskStatus {
  switch (event.action) {
    case "task.assigned":
      return current === "inbox" ? "todo" : current;
    case "task.claimed":
      return "in_progress";
    case "task.released":
      return current === "in_progress" ? "todo" : current;
    case "task.completed":
      return "done";
    case "task.updated":
      return isStatus(event.data.status) ? event.data.status : current;
    default:
      return current;
  }
}

/**
 * Replays each task's activity log into the statuses it held over time. Events written
 * before status changes were logged are reconciled against the task's current status.
 */
export function buildJourneys<T extends JourneyTask>(tasks: readonly T[], events: readonly TaskEventLike[]): Journey<T>[] {
  const byTask = new Map<string, TaskEventLike[]>();
  for (const event of [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const list = byTask.get(event.entityId);
    if (list) list.push(event);
    else byTask.set(event.entityId, [event]);
  }

  return tasks.map((task) => {
    const log = byTask.get(task.id) ?? [];
    const captured = log.find((event) => event.action === "task.captured");
    let status: TaskStatus = isStatus(captured?.data.status) ? captured.data.status : "inbox";
    const stops: Stop[] = [{ status, at: task.createdAt }];

    for (const event of log) {
      const next = statusAfter(status, event);
      if (next === status) continue;
      status = next;
      stops.push({ status, at: event.createdAt > task.createdAt ? event.createdAt : task.createdAt });
    }

    if (status !== task.status) {
      const changedAt = task.status === "done" && task.completedAt ? task.completedAt : task.updatedAt;
      const last = stops.at(-1)!.at;
      stops.push({ status: task.status, at: changedAt > last ? changedAt : last });
    }
    return { task, stops };
  });
}

/** Where a journey stood at a moment, or undefined before the task existed. */
export function statusAt(journey: Journey, at: Date): TaskStatus | undefined {
  let current: TaskStatus | undefined;
  for (const stop of journey.stops) {
    if (stop.at > at) break;
    current = stop.status;
  }
  return current;
}

export interface Segment {
  status: "inbox" | "todo" | "in_progress";
  /** Fractions of the window, 0 to 1. */
  from: number;
  to: number;
}

export type TrackEnd = { kind: "arrived" | "dropped"; at: number } | { kind: "open" };

export interface Track {
  segments: Segment[];
  end: TrackEnd;
}

/** The open-status segments a track draws inside the window, and how the track ends. */
export function trackOf(journey: Journey, window: TimeWindow): Track {
  const segments: Segment[] = [];
  const stops = journey.stops;
  for (const [index, stop] of stops.entries()) {
    if (!isOpenTaskStatus(stop.status)) continue;
    const until = stops[index + 1]?.at ?? window.now;
    const from = fractionOf(window, stop.at);
    const to = fractionOf(window, until);
    if (to > from) segments.push({ status: stop.status as Segment["status"], from, to });
  }

  const last = stops.at(-1)!;
  const end: TrackEnd =
    last.status === "done" || last.status === "dropped"
      ? { kind: last.status === "done" ? "arrived" : "dropped", at: fractionOf(window, last.at) }
      : { kind: "open" };
  return { segments, end };
}

export type FlowCounts = Record<Station, number>;

/**
 * Tasks at each station at the end of every day in the window (or now, for today).
 * "done" counts arrivals since the window started, so old history does not swamp the chart.
 */
export function cumulativeFlow(journeys: readonly Journey[], window: TimeWindow): { day: Date; counts: FlowCounts }[] {
  const lastDay = startOfUtcDay(window.now);
  return window.days
    .filter((day) => day <= lastDay)
    .map((day) => {
      const at = day.getTime() === lastDay.getTime() ? window.now : addDays(day, 1);
      const counts: FlowCounts = { inbox: 0, todo: 0, in_progress: 0, done: 0 };
      for (const journey of journeys) {
        const status = statusAt(journey, at);
        if (!status || status === "dropped") continue;
        if (status === "done") {
          const arrived = [...journey.stops].reverse().find((stop) => stop.status === "done")!.at;
          if (arrived < window.start) continue;
        }
        counts[status as Station] += 1;
      }
      return { day, counts };
    });
}

/** Whole days between two calendar dates, positive when `to` is later. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS);
}
