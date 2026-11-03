import { CalendarRange } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { cx } from "@/lib/cx";
import { addDays, dayOf, daysBetween } from "@/lib/dates";
import { isLate, TASK_STATUS_META } from "@/lib/domain";
import { formatDay, formatDueDate, pluralize } from "@/lib/format";
import { fractionOf, trackOf, type Journey, type JourneyGroup, type Segment, type TimeWindow } from "@/lib/timeline";
import type { TaskView } from "@/server/domain/tasks";

import { EmptyState } from "../ui/stat";

/** State is carried by line form as well as hue: dashed while waiting, solid while moving. */
const SEGMENT_FORM: Record<Segment["status"], string> = {
  inbox: "h-0 border-t-2 border-dashed border-line-inbox",
  todo: "h-0 border-t-2 border-dashed border-line-todo",
  in_progress: "h-1.5 rounded-full bg-station-progress",
};

const at = (fraction: number): CSSProperties => ({ left: `${fraction * 100}%` });
const span = (from: number, to: number): CSSProperties => ({ left: `${from * 100}%`, width: `${(to - from) * 100}%` });

/** The end of the due day, which is when an open task becomes late. */
const dueAt = (dueDate: string) => addDays(dayOf(dueDate), 1);

/** "In progress for 3 days" or "Done Nov 1": where the task stands, in words. */
function standing(journey: Journey<TaskView>, now: Date): string {
  const { task } = journey;
  const since = journey.stops.at(-1)!.at;
  const label = TASK_STATUS_META[task.status].label;
  if (task.status === "done" || task.status === "dropped") return `${label} ${formatDay(since)}`;
  const days = daysBetween(since, now);
  return days === 0 ? `${label} since today` : `${label} for ${pluralize(days, "day")}`;
}

function dueNote(task: TaskView, now: Date): { text: string; late: boolean } | null {
  if (!task.dueDate || task.status === "dropped") return null;
  if (isLate(task, now)) return { text: `Late, due ${formatDueDate(task.dueDate)}`, late: true };
  return { text: `Due ${formatDueDate(task.dueDate)}`, late: false };
}

function Track({ journey, window }: { journey: Journey<TaskView>; window: TimeWindow }) {
  const { task } = journey;
  const { segments, end } = trackOf(journey, window);
  const start = fractionOf(window, journey.stops[0]!.at);
  const finish = end.kind === "open" ? fractionOf(window, window.now) : end.at;
  const due = task.dueDate && task.status !== "dropped" ? fractionOf(window, dueAt(task.dueDate)) : null;
  const late = isLate(task, window.now);

  return (
    <div aria-hidden data-end={end.kind} className="relative h-6">
      {due !== null && due < finish && <span className="absolute inset-y-1 rounded-xs bg-late/15" style={span(due, finish)} />}
      {segments.map((segment) => (
        <span
          key={`${segment.status}-${segment.from}`}
          data-segment={segment.status}
          className={cx("absolute top-1/2 -translate-y-1/2", SEGMENT_FORM[segment.status])}
          style={span(segment.from, segment.to)}
        />
      ))}
      {start > 0 && <span className="absolute top-1/2 size-2 -translate-1/2 rounded-full border-2 border-edge bg-panel" style={at(start)} />}
      {due !== null && (
        <span
          title={`Due ${formatDueDate(task.dueDate!)}`}
          className={cx("absolute inset-y-0.5 w-0.5 -translate-x-1/2 rounded-xs", late ? "bg-late" : "bg-ink-2")}
          style={at(due)}
        />
      )}
      {end.kind === "arrived" && (
        <span className="absolute top-1/2 size-2.5 -translate-1/2 rounded-full bg-station-done ring-2 ring-panel" style={at(end.at)} />
      )}
      {end.kind === "dropped" && <span className="absolute top-1/2 h-3.5 w-0.5 -translate-1/2 rotate-30 bg-muted" style={at(end.at)} />}
    </div>
  );
}

/** On phones a label sits above its track, so it is lifted over the now and day lines. */
const ROW_LABEL = "min-w-0 max-sm:relative max-sm:z-10 max-sm:bg-panel";

function TrackRow({ journey, window }: { journey: Journey<TaskView>; window: TimeWindow }) {
  const { task } = journey;
  const note = dueNote(task, window.now);
  const dropped = task.status === "dropped";
  return (
    <li
      data-task={task.id}
      className={cx(
        "relative grid grid-cols-1 items-center gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[var(--label)_minmax(0,1fr)]",
        "group-has-[li:hover]/tt:opacity-45 hover:opacity-100! motion-safe:transition-opacity motion-safe:duration-(--dur-short)",
      )}
    >
      <div className={ROW_LABEL}>
        <p className={cx("truncate text-sm", dropped ? "text-muted line-through" : "text-ink")} title={task.title}>
          {task.title}
        </p>
        <p className="flex flex-wrap gap-x-2 text-2xs text-muted">
          <span>{standing(journey, window.now)}</span>
          {note && <span className={cx(note.late && "font-semibold text-late-ink")}>{note.text}</span>}
          {task.claimedByName && <span>Held by {task.claimedByName}</span>}
        </p>
      </div>
      <Track journey={journey} window={window} />
    </li>
  );
}

interface Tick {
  at: number;
  label?: string;
  week: boolean;
}

/** Share of the axis a date label or the Now chip covers on the narrowest track, a phone's. */
const LABEL_SPAN = 0.14;

/**
 * Day lines when a day is wide enough to see, week lines otherwise. Mondays are labelled, or
 * every day in a window under a week; a label the Now chip would cover is left off.
 */
function ticksOf(window: TimeWindow, now: number): Tick[] {
  const dense = window.days.length > 40;
  const daily = window.days.length <= 7;
  return window.days.flatMap((day): Tick[] => {
    const monday = day.getUTCDay() === 1;
    if (dense && !monday) return [];
    const at = fractionOf(window, day);
    const labelled = (daily || monday) && Math.abs(at - now) >= LABEL_SPAN;
    return [{ at, week: monday, label: labelled ? formatDay(day) : undefined }];
  });
}

export type TimetableGroup = JourneyGroup<TaskView>;

interface TimetableProps {
  window: TimeWindow;
  groups: readonly TimetableGroup[];
  empty?: ReactNode;
}

/**
 * Every task as a track on one time axis, coloured by the station it stood at each day,
 * with the red now line through all of them. Hovering a track dims the others.
 */
export function Timetable({ window, groups, empty }: TimetableProps) {
  if (groups.length === 0) {
    return (
      empty ?? (
        <EmptyState icon={<CalendarRange />} title="Nothing moved in this window">
          Tasks appear here from the day they are captured until they are done or dropped.
        </EmptyState>
      )
    );
  }
  const now = fractionOf(window, window.now);
  const ticks = ticksOf(window, now);
  const dense = window.days.length > 40;

  return (
    <div className="group/tt relative [--label:11rem] lg:[--label:15rem]">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-0 sm:left-[calc(var(--label)+1rem)]">
        <div className="absolute inset-y-0 right-0 bg-sunken/70" style={{ left: `${now * 100}%` }} />
        {ticks.map((tick) => (
          <span key={tick.at} className={cx("absolute inset-y-0 w-px", tick.week ? "bg-rule" : "bg-rule/50")} style={at(tick.at)} />
        ))}
      </div>

      <div aria-hidden className="relative grid h-7 grid-cols-1 gap-x-4 sm:grid-cols-[var(--label)_minmax(0,1fr)]">
        <span className="hidden sm:block" />
        <div className="relative">
          {ticks
            .filter((tick) => tick.label)
            .map((tick, index) => (
              <span
                key={tick.at}
                data-tick
                className={cx("absolute bottom-1 pl-1 text-2xs whitespace-nowrap text-muted", dense && index % 2 === 1 && "max-sm:hidden")}
                style={at(tick.at)}
              >
                {tick.label}
              </span>
            ))}
        </div>
      </div>

      {groups.map((group) => {
        const tracks = (
          <ol className={cx(!group.title && "relative border-t border-rule")}>
            {group.journeys.map((journey) => (
              <TrackRow key={journey.task.id} journey={journey} window={window} />
            ))}
          </ol>
        );
        if (!group.title) return <div key={group.key}>{tracks}</div>;
        return (
          <section key={group.key} aria-label={group.title} className="relative">
            <h3 className="relative flex items-baseline gap-2 border-t border-rule bg-panel py-1.5 text-xs font-bold text-ink-2 max-sm:z-10">
              {group.href ? (
                <Link href={group.href} className="truncate hover:text-ink link">
                  {group.title}
                </Link>
              ) : (
                <span className="truncate">{group.title}</span>
              )}
              <span className="shrink-0 font-normal text-muted">{pluralize(group.journeys.length, "task")}</span>
            </h3>
            {tracks}
          </section>
        );
      })}

      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-0 sm:left-[calc(var(--label)+1rem)]">
        <div data-now className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-late" style={at(now)}>
          <span className="absolute top-6 left-0 -translate-y-full rounded-xs bg-late-ink px-1 text-2xs leading-4 font-bold text-panel">
            Now
          </span>
        </div>
      </div>
    </div>
  );
}

/** The key to the timetable's line forms. */
export function TimetableLegend({ className }: { className?: string }) {
  const item = "inline-flex items-center gap-2";
  return (
    <ul className={cx("flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-2", className)}>
      <li className={item}>
        <span aria-hidden className="w-6 border-t-2 border-dashed border-line-inbox" />
        Inbox
      </li>
      <li className={item}>
        <span aria-hidden className="w-6 border-t-2 border-dashed border-line-todo" />
        To do
      </li>
      <li className={item}>
        <span aria-hidden className="h-1.5 w-6 rounded-full bg-station-progress" />
        In progress
      </li>
      <li className={item}>
        <span aria-hidden className="size-2.5 rounded-full bg-station-done" />
        Done
      </li>
      <li className={item}>
        <span aria-hidden className="h-3.5 w-0.5 rotate-30 bg-muted" />
        Dropped
      </li>
      <li className={item}>
        <span aria-hidden className="h-3.5 w-0.5 rounded-xs bg-ink-2" />
        Due date
      </li>
      <li className={item}>
        <span aria-hidden className="h-3 w-6 rounded-xs bg-late/15" />
        Late
      </li>
      <li className={item}>
        <span aria-hidden className="h-3.5 w-0.5 bg-late" />
        Now
      </li>
    </ul>
  );
}
