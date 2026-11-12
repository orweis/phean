import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { byDueDay, type MonthGrid } from "@/lib/calendar";
import { cx } from "@/lib/cx";
import { dayOf, todayIso } from "@/lib/dates";
import { isLate } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { TaskQuery } from "@/lib/task-views";
import type { TaskView } from "@/server/domain/tasks";

import { FlowLegend } from "./charts/flow-bar";
import { StationDot, TaskPeekLink, WaitingNote } from "./task-marks";
import { buttonClasses } from "./ui/button";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** How many tasks a day's cell lists before folding the rest. */
const PER_DAY = 3;

const dayLabel = (day: string) => dayOf(day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** One task in a day: its station as a dot (named for screen readers), its title into the side peek, late in crimson, and what waits on you in ember. */
function CalendarTask({ task, slug }: { task: TaskView; slug: string }) {
  const late = isLate(task);
  return (
    <li className="flex min-w-0 items-start gap-1.5 text-xs leading-4">
      <StationDot status={task.status} className="mt-1" />
      <span className="min-w-0">
        <TaskPeekLink
          slug={slug}
          taskId={task.id}
          className={cx(
            "break-words hover:underline data-selected:rounded-xs data-selected:bg-accent-tint data-selected:outline-2 data-selected:outline-accent",
            late ? "font-semibold text-late-ink" : task.status === "done" ? "text-muted line-through" : "text-ink",
          )}
        >
          {task.title}
          {late && <span className="sr-only"> (late)</span>}
        </TaskPeekLink>
        {task.inputRequest && <WaitingNote kind={task.inputRequest.kind} className="block" />}
      </span>
    </li>
  );
}

function DayTasks({ tasks, slug }: { tasks: readonly TaskView[]; slug: string }) {
  const shown = tasks.slice(0, PER_DAY);
  const more = tasks.slice(PER_DAY);
  return (
    <>
      <ul className="space-y-1">
        {shown.map((task) => (
          <CalendarTask key={task.id} task={task} slug={slug} />
        ))}
      </ul>
      {more.length > 0 && (
        <details className="group/more mt-1">
          <summary className="cursor-pointer list-none text-xs font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">{more.length} more</span>
            <span className="hidden group-open/more:inline">Fewer</span>
          </summary>
          <ul className="mt-1 space-y-1">
            {more.map((task) => (
              <CalendarTask key={task.id} task={task} slug={slug} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * A month of due dates: a week-by-week grid on wider screens and, on phones, the days that have
 * tasks as a list. Earlier and later months are a link away, and the filters carry over. Tasks with
 * no due date cannot be placed, so the header says how many there are and where to find them.
 */
export function TaskCalendar({ grid, tasks, undated, slug, query }: { grid: MonthGrid; tasks: readonly TaskView[]; undated: number; slug: string; query: TaskQuery }) {
  const days = byDueDay(tasks);
  const today = todayIso();
  const monthHref = (month?: string) => routes.board(slug, { ...query, view: "calendar", month });
  const busy = grid.weeks.flat().filter((day) => day.startsWith(grid.month) && days.has(day));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-3">
        <h2 className="text-md font-semibold text-ink" aria-live="polite">
          {grid.title}
        </h2>
        <nav aria-label="Month" className="flex items-center gap-1">
          <Link href={monthHref(grid.previous)} scroll={false} className={buttonClasses("ghost", "sm")} aria-label="Previous month">
            <ChevronLeft aria-hidden />
          </Link>
          <Link href={monthHref(undefined)} scroll={false} className={buttonClasses("ghost", "sm")}>
            This month
          </Link>
          <Link href={monthHref(grid.next)} scroll={false} className={buttonClasses("ghost", "sm")} aria-label="Next month">
            <ChevronRight aria-hidden />
          </Link>
        </nav>
        <FlowLegend className="w-full" />
        {undated > 0 && (
          <p className="w-full text-xs text-muted">
            {pluralize(undated, "task")} without a due date are not on the calendar.{" "}
            <Link href={routes.board(slug, { ...query, view: "table", month: undefined, due: "none" })} className="font-semibold link">
              See them in the table
            </Link>
          </p>
        )}
      </div>

      <table className="w-full table-fixed border-collapse max-sm:hidden">
        <caption className="sr-only">{`Tasks due in ${grid.title}`}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col" className="border-b border-rule px-2 py-2 text-left text-xs font-semibold text-muted">
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const inMonth = day.startsWith(grid.month);
                const isToday = day === today;
                return (
                  <td
                    key={day}
                    data-day={day}
                    aria-current={isToday ? "date" : undefined}
                    className={cx("h-28 border-r border-b border-rule px-2 py-1.5 align-top last:border-r-0", !inMonth && "bg-fill/60")}
                  >
                    <p className={cx("mb-1 text-xs", isToday ? "inline-flex size-5 items-center justify-center rounded-full font-bold text-late-ink ring-2 ring-late" : inMonth ? "font-semibold text-ink-2" : "text-muted")}>
                      <span className="sr-only">{dayLabel(day)}</span>
                      <span aria-hidden>{Number(day.slice(8))}</span>
                    </p>
                    {days.has(day) && <DayTasks tasks={days.get(day)!} slug={slug} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <ol aria-label={`Days with tasks due in ${grid.title}`} className="divide-y divide-rule sm:hidden">
        {busy.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">Nothing is due this month.</li>}
        {busy.map((day) => (
          <li key={day} className="px-5 py-3">
            <p className={cx("mb-1.5 text-xs font-semibold", day === today ? "text-late-ink" : "text-ink-2")}>
              {dayLabel(day)}
              {day === today && " · Today"}
            </p>
            <DayTasks tasks={days.get(day)!} slug={slug} />
          </li>
        ))}
      </ol>
    </div>
  );
}
