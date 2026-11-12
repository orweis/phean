import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/cx";
import { isLate, PRIORITY_META } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { nextSort, sortTasks, TABLE_COLUMN_LABELS, TABLE_COLUMNS, type TableSort } from "@/lib/task-table";
import type { TaskQuery } from "@/lib/task-views";
import { stageOf, type Stage } from "@/lib/workflow";
import type { TaskView } from "@/server/domain/tasks";

import { WaitingBadge } from "./agent-sessions";
import { GoalLink } from "./goal-link";
import { InlineDue, StageBadge } from "./task-card";
import { TaskPeekLink } from "./task-marks";
import { MetaBadge } from "./ui/badge";
import { PINNED_CELL, TH } from "./ui/table";

/**
 * Every task as a row. Each column heading is a link that sorts by it (again to reverse), held in
 * the URL so a sorted table can be shared; `aria-sort` says which column leads. Titles open the
 * task in the side peek, over the table.
 */
export function TaskTable({ tasks, slug, sort, query, workflow }: { tasks: readonly TaskView[]; slug: string; sort: TableSort; query: TaskQuery; workflow: readonly Stage[] }) {
  const rank = (task: TaskView) => {
    const stage = stageOf(workflow, task);
    return stage ? workflow.indexOf(stage) : workflow.length;
  };
  const rows = sortTasks(tasks, sort, rank);
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">
          {`Tasks, sorted by ${TABLE_COLUMN_LABELS[sort.column].toLowerCase()}, ${sort.direction === "asc" ? "ascending" : "descending"}`}
        </caption>
        <thead>
          <tr className="border-b border-rule">
            {TABLE_COLUMNS.map((column, index) => {
              const active = sort.column === column;
              const next = nextSort(sort, column);
              const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={column}
                  scope="col"
                  aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                  className={cx(TH, "text-left", index === 0 && cx("pl-5", PINNED_CELL), index === TABLE_COLUMNS.length - 1 && "pr-5", column === "due" && "max-sm:hidden")}
                >
                  <Link
                    href={routes.board(slug, { ...query, view: "table", sort: next.column, dir: next.direction })}
                    scroll={false}
                    className={cx("group/sort inline-flex items-center gap-1 rounded-xs hover:text-ink", active && "text-ink")}
                  >
                    {TABLE_COLUMN_LABELS[column]}
                    <span className="sr-only">{`, sort ${next.direction === "asc" ? "ascending" : "descending"}`}</span>
                    {active ? (
                      <Arrow aria-hidden className="size-3" />
                    ) : (
                      <ArrowUpDown aria-hidden className="size-3 opacity-0 transition-opacity group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100" />
                    )}
                  </Link>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((task) => (
            <tr
              key={task.id}
              data-task={task.id}
              className="align-top transition-colors duration-(--dur-micro) hover:bg-fill has-[[data-selected]]:bg-accent-tint/50 has-[[data-selected]]:shadow-[inset_3px_0_0_var(--color-accent)]"
            >
              <td className={cx("max-w-96 min-w-56 py-2.5 pr-3 pl-5 max-sm:min-w-40", PINNED_CELL)}>
                <TaskPeekLink slug={slug} taskId={task.id} className="font-semibold text-ink link">
                  {task.title}
                </TaskPeekLink>
                {task.parentTitle && <p className="mt-0.5 truncate text-xs text-muted">Subtask of {task.parentTitle}</p>}
                {/* On a phone the Due column is off to the side, so lateness shows under the title. */}
                {task.dueDate && (
                  <p className="mt-0.5 sm:hidden">
                    <InlineDue dueDate={task.dueDate} late={isLate(task)} />
                  </p>
                )}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex flex-col items-start gap-1">
                  <StageBadge task={task} slug={slug} />
                  {task.inputRequest && <WaitingBadge slug={slug} kind={task.inputRequest.kind} taskId={task.id} />}
                </div>
              </td>
              <td className="px-3 py-2.5">
                {/* Medium is most tasks, so only the priorities that stand out wear a badge. */}
                {task.priority === "medium" ? <span className="text-xs text-muted">Medium</span> : <MetaBadge meta={PRIORITY_META} value={task.priority} />}
              </td>
              <td className="px-3 py-2.5 max-sm:hidden">{task.dueDate ? <InlineDue dueDate={task.dueDate} late={isLate(task)} /> : <span className="text-xs text-muted">None</span>}</td>
              <td className="max-w-56 px-3 py-2.5 text-xs">
                {task.goalId && task.goalTitle ? <GoalLink slug={slug} goalId={task.goalId} title={task.goalTitle} /> : <span className="text-muted">None</span>}
              </td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap text-ink-2">{task.claimedByName ?? <span className="text-muted">No one</span>}</td>
              <td className="py-2.5 pr-5 pl-3 text-xs whitespace-nowrap text-muted">{timeAgo(task.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
