import { KanbanSquare, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FlowBar } from "@/components/charts/flow-bar";
import { STATION_MARK } from "@/components/goal-tree";
import { ManualEntry } from "@/components/manual-entry";
import { PageHeader } from "@/components/page-header";
import { TaskLine } from "@/components/task-card";
import { MetaBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ExpandableRow } from "@/components/ui/expandable-row";
import { segment, SEGMENTED } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/stat";
import { cx } from "@/lib/cx";
import { isPastDue } from "@/lib/dates";
import { GOAL_STATUS_META, type GoalStatus } from "@/lib/domain";
import { percent, pluralize } from "@/lib/format";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals, type GoalWithProgress } from "@/server/domain/goals";
import { can } from "@/server/domain/policy";
import { listGoalTasks, type TaskView } from "@/server/domain/tasks";

export const metadata: Metadata = { title: "Goals" };

/** Which goals the page lists: the open ones by default, or what was finished. */
const VIEWS = {
  open: { label: "Open", statuses: ["proposed", "active"] },
  achieved: { label: "Achieved", statuses: ["achieved"] },
  abandoned: { label: "Abandoned", statuses: ["abandoned"] },
  all: { label: "All", statuses: ["proposed", "active", "achieved", "abandoned"] },
} as const satisfies Record<string, { label: string; statuses: readonly GoalStatus[] }>;

type View = keyof typeof VIEWS;

/** How many of a goal's tasks the peek lists before pointing to the goal itself. */
const PEEK_LIMIT = 8;

/** A goal's own tasks for the peek: open ones, most urgent first, then the done ones as a count. */
function GoalPeek({ goal, tasks, slug }: { goal: GoalWithProgress; tasks: readonly TaskView[]; slug: string }) {
  const open = tasks.filter((task) => task.status !== "done");
  const done = tasks.length - open.length;
  const shown = open.slice(0, PEEK_LIMIT);
  return (
    <div className="mt-2 mb-1 rounded-md bg-fill/60 px-4 py-1">
      {shown.length > 0 ? (
        <ul aria-label={`Open tasks in ${goal.title}`}>
          {shown.map((task) => (
            <TaskLine key={task.id} task={task} slug={slug} />
          ))}
        </ul>
      ) : (
        <p className="py-3 text-sm text-muted">{tasks.length ? "Every task here is done." : "No tasks filed directly under this goal."}</p>
      )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule py-2.5 text-xs text-muted">
        {open.length > shown.length && <span>{pluralize(open.length - shown.length, "more open task")}</span>}
        {done > 0 && <span>{pluralize(done, "done task")}</span>}
        <Link href={routes.goal(slug, goal.id)} className="font-semibold link">
          Open the goal
        </Link>
        <Link href={routes.board(slug, goal.id)} className="font-semibold link">
          See it on the board
        </Link>
      </p>
    </div>
  );
}

/** Every goal as one line (its station, progress and what is late), each opening onto its own tasks. */
export default async function GoalsPage({ params, searchParams }: PageProps<"/w/[slug]/goals">) {
  const { slug } = await params;
  const requested = queryParam((await searchParams).show);
  const view: View = requested && requested in VIEWS ? (requested as View) : "open";
  const { ctx } = await requireWorkspace(slug);
  const [goals, tasks] = await Promise.all([listGoals(ctx, {}), listGoalTasks(ctx, {})]);
  const statuses: readonly GoalStatus[] = VIEWS[view].statuses;
  const shown = goals.filter((goal) => statuses.includes(goal.status));
  // A goal's place in the tree only reads when its parents are listed too.
  const listed = new Set(shown.map((goal) => goal.id));
  const depthOf = (goal: GoalWithProgress): number => (goal.parentId && listed.has(goal.parentId) ? goal.depth : 0);
  const byGoal = Map.groupBy(tasks, (task) => task.goalId ?? "");

  return (
    <>
      <PageHeader
        title="Goals"
        description="Every goal agents proposed or people set, with its progress rolled up from its sub-goals. Open a goal's tasks here for a quick look, or the goal itself for its timetable, memory and documents."
        actions={
          <>
            <ManualEntry slug={slug} goals={goals} canAddTask={can(ctx.actor, "task:write")} canAddGoal={can(ctx.actor, "goal:write")} />
            <nav aria-label="Show goals" className={SEGMENTED}>
              {(Object.keys(VIEWS) as View[]).map((key) => (
                <Link key={key} href={routes.goals(slug, key === "open" ? undefined : key)} aria-current={key === view ? "page" : undefined} className={segment(key === view)}>
                  {VIEWS[key].label}
                </Link>
              ))}
            </nav>
          </>
        }
      />
      <Card>
        <CardBody className="py-1">
          {shown.length === 0 ? (
            <EmptyState icon={<Target />} title={view === "open" ? "No open goals" : `No ${VIEWS[view].label.toLowerCase()} goals`}>
              {view === "open" ? "Agents propose goals as they triage the inbox. You can also start one with Add manually." : "Goals land here once a person marks them."}
              {view === "open" && (
                <span className="mt-3 block">
                  <ButtonLink href={routes.board(slug)} variant="secondary" size="sm">
                    <KanbanSquare aria-hidden /> Open the board
                  </ButtonLink>
                </span>
              )}
            </EmptyState>
          ) : (
            <ul>
              {shown.map((goal) => {
                const own = byGoal.get(goal.id) ?? [];
                const openTasks = own.filter((task) => task.status !== "done");
                const late = openTasks.filter((task) => isPastDue(task.dueDate)).length;
                const finished = goal.status === "achieved" || goal.status === "abandoned";
                return (
                  <li key={goal.id} data-goal={goal.id} className="border-b border-rule py-2.5 last:border-b-0" style={{ paddingLeft: `${depthOf(goal) * 1.5}rem` }}>
                    <ExpandableRow
                      subject={`in ${goal.title}`}
                      count={own.length ? pluralize(openTasks.length, "open task") : "No tasks"}
                      header={
                        <>
                          <div className="flex min-w-0 flex-1 basis-56 items-center gap-2.5">
                            <span aria-hidden className={cx("size-3.5 shrink-0 rounded-full", STATION_MARK[goal.status])} />
                            <Link href={routes.goal(slug, goal.id)} className={cx("truncate text-sm font-semibold link", finished ? "text-muted" : "text-ink")}>
                              {goal.title}
                            </Link>
                            {goal.status !== "active" && <MetaBadge meta={GOAL_STATUS_META} value={goal.status} />}
                            {late > 0 && <span className="text-xs font-semibold whitespace-nowrap text-late-ink">{late} late</span>}
                          </div>
                          <div className="flex w-full items-center gap-3 sm:w-56">
                            <FlowBar counts={goal.rollup} label={`${goal.title} tasks by status`} className="flex-1" />
                            <span className="w-20 shrink-0 text-right text-xs text-muted">
                              <span className="font-semibold text-ink">{percent(goal.progress)}</span> {goal.rollup.done}/{goal.rollup.total}
                            </span>
                          </div>
                        </>
                      }
                      panel={<GoalPeek goal={goal} tasks={own} slug={slug} />}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
