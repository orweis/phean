/**
 * Pure geometry and history for the timeline views: where each task stood over time
 * (its journey), the segments a track draws, and the cumulative flow of work per day.
 * Client-safe; every date is a UTC calendar day, matching how due dates are compared.
 */
import { addDays, daysBetween, startOfUtcDay } from "./dates";
import { isLate, isOneOf, isOpenTaskStatus, PRIORITIES, STATIONS, TASK_STATUSES, zeroCounts, type Priority, type Station, type TaskStatus } from "./domain";
import { formatDay } from "./format";
import { routes } from "./routes";

export const TIMELINE_WINDOWS = [14, 30, 90] as const;
export type TimelineDays = (typeof TIMELINE_WINDOWS)[number];
/** Days after today the timetable shows, so upcoming due dates are on the chart. */
export const TIMELINE_AHEAD_DAYS = 7;
/** The shortest window a short history is fitted to, so a new workspace still has an axis. */
export const TIMELINE_MIN_DAYS = 7;

export function parseTimelineDays(value: string | undefined): TimelineDays {
  const days = Number(value);
  return isOneOf(TIMELINE_WINDOWS, days) ? days : 14;
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

/**
 * Starts the window on the day the earliest journey began when that is later than the window's
 * start, so a short history spreads across the axis instead of filling a sliver at its end.
 */
export function fitWindow(window: TimeWindow, journeys: readonly Journey[]): TimeWindow {
  const first = journeys.reduce<Date | undefined>((earliest, { stops }) => (!earliest || stops[0]!.at < earliest ? stops[0]!.at : earliest), undefined);
  const history = first ? daysBetween(first, window.now) + 1 : 0;
  const days = Math.max(TIMELINE_MIN_DAYS, history);
  return days < pastDays(window) ? timeWindow(days, window.now, daysBetween(window.now, window.end) - 1) : window;
}

/** Days the window shows up to and including today. */
function pastDays(window: TimeWindow): number {
  return daysBetween(window.start, window.now) + 1;
}

/** "over the last 30 days", or "since Oct 12" when the window was fitted to a shorter history. */
export function windowSpan(window: TimeWindow, requestedDays: number): string {
  return pastDays(window) < requestedDays ? `since ${formatDay(window.start)}` : `over the last ${requestedDays} days`;
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

const isStatus = (value: unknown): value is TaskStatus => isOneOf(TASK_STATUSES, value);

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
      const counts = zeroCounts(STATIONS);
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

/** A task with what the timeline ranks and groups it by. */
export interface PlannedTask extends JourneyTask {
  priority: Priority;
  dueDate: string | null;
  goalId: string | null;
}

export interface JourneyTotals {
  total: number;
  /** Arrived inside the window; older arrivals are history, not this window's work. */
  done: number;
  dropped: number;
  open: number;
  late: number;
}

export function journeyTotals(journeys: readonly Journey<PlannedTask>[], window: TimeWindow): JourneyTotals {
  const totals: JourneyTotals = { total: journeys.length, done: 0, dropped: 0, open: 0, late: 0 };
  for (const { task } of journeys) {
    if (task.status === "done" && task.completedAt && task.completedAt >= window.start) totals.done += 1;
    if (task.status === "dropped") totals.dropped += 1;
    if (isOpenTaskStatus(task.status)) totals.open += 1;
    if (isLate(task, window.now)) totals.late += 1;
  }
  return totals;
}

/**
 * The `limit` most pressing open tracks: late first, then by priority, due date and age.
 * They keep the order they set out in, so the timetable still reads as a timetable.
 */
export function mostPressing<T extends PlannedTask>(journeys: readonly Journey<T>[], limit: number, now: Date): Journey<T>[] {
  const rank = ({ task }: Journey<T>) => [isLate(task, now) ? 0 : 1, PRIORITIES.indexOf(task.priority), task.dueDate ?? "9999-12-31"] as const;
  return journeys
    .map((journey, order) => ({ journey, order, rank: rank(journey) }))
    .filter(({ journey }) => isOpenTaskStatus(journey.task.status))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2].localeCompare(b.rank[2]) || a.order - b.order)
    .slice(0, limit)
    .sort((a, b) => a.order - b.order)
    .map(({ journey }) => journey);
}

export interface JourneyGroup<T extends JourneyTask = PlannedTask> {
  key: string;
  /** Untitled groups draw their tracks without a heading, as one flat list. */
  title?: string;
  href?: string;
  journeys: Journey<T>[];
}

/** Groups journeys under their goals in goal-tree order; unfiled tasks come last. */
export function groupByGoal<T extends PlannedTask>(
  journeys: readonly Journey<T>[],
  goals: readonly { id: string; title: string }[],
  slug: string,
): JourneyGroup<T>[] {
  const groups: JourneyGroup<T>[] = goals.map((goal) => ({ key: goal.id, title: goal.title, href: routes.goal(slug, goal.id), journeys: [] }));
  const unfiled: JourneyGroup<T> = { key: "unfiled", title: "Not filed under a goal", journeys: [] };
  const byId = new Map(groups.map((group) => [group.key, group]));
  for (const journey of journeys) (byId.get(journey.task.goalId ?? "") ?? unfiled).journeys.push(journey);
  return [...groups, unfiled].filter((group) => group.journeys.length > 0);
}
