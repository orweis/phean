import { Bot, CalendarRange, ChevronRight, ListTodo, Pencil, Plus, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { ActivityFeed } from "@/components/activity-feed";
import { AddTaskForm } from "@/components/add-task-form";
import { FlowStat } from "@/components/charts/flow-bar";
import { Timetable } from "@/components/charts/timetable";
import { EditGoalForm, NewGoalForm } from "@/components/goal-forms";
import { GoalStatusActions } from "@/components/goal-status-actions";
import { DocumentChips } from "@/components/documents/document-chips";
import { GoalTree } from "@/components/goal-tree";
import { MemoryList } from "@/components/memory-list";
import { RememberForm } from "@/components/remember-form";
import { TaskRow } from "@/components/task-card";
import { MetaBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { EmptyState, Stat, StatStrip } from "@/components/ui/stat";
import { GOAL_MAX_DEPTH, GOAL_STATUS_META } from "@/lib/domain";
import { percent, pluralize, timeAgo } from "@/lib/format";
import { subtreeIds } from "@/lib/goal-tree";
import { routes } from "@/lib/routes";
import { groupByGoal, journeyTotals, windowSpan } from "@/lib/timeline";
import { requireWorkspace } from "@/server/auth/session";
import { listDocuments } from "@/server/domain/documents";
import { listGoals } from "@/server/domain/goals";
import { getGoalDetail, getJourneys } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { orNotFound } from "@/server/web";

const TIMETABLE_DAYS = 30;

const loadGoalDetail = cache(async (slug: string, goalId: string) => {
  const { ctx } = await requireWorkspace(slug);
  return orNotFound(getGoalDetail(ctx, { goalId }));
});

export async function generateMetadata({ params }: PageProps<"/w/[slug]/goals/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const { goal } = await loadGoalDetail(slug, id);
  return { title: goal.title };
}

export default async function GoalPage({ params }: PageProps<"/w/[slug]/goals/[id]">) {
  const { slug, id } = await params;
  const { ctx } = await requireWorkspace(slug);
  const [{ goal, ancestors, tasks, memories, activity }, goals, { window, journeys }, documents] = await orNotFound(
    Promise.all([
      loadGoalDetail(slug, id),
      listGoals(ctx, {}),
      getJourneys(ctx, { goalId: id, days: TIMETABLE_DAYS }),
      listDocuments(ctx, { goalId: id, limit: 20 }),
    ]),
  );
  const canWrite = can(ctx.actor, "task:write");
  const canDecide = can(ctx.actor, "goal:decide");
  const canEditGoals = can(ctx.actor, "goal:write");
  const below = new Set(subtreeIds(goals, goal.id));
  const subtree = goals.filter((candidate) => below.has(candidate.id));
  const subGoals = subtree.filter((candidate) => candidate.id !== goal.id);
  const { late, done: doneInWindow } = journeyTotals(journeys, window);
  const CreatorIcon = goal.createdByType === "agent" ? Bot : Target;
  // With only this goal's own tasks on the line, its name as a group heading would repeat the page title.
  const grouped = groupByGoal(journeys, subtree, slug);
  const trackGroups = grouped.length === 1 && grouped[0]!.key === goal.id ? [{ ...grouped[0]!, title: undefined }] : grouped;

  return (
    <>
      {/* A path that reads as one: the workspace, each goal above this one, then this goal. */}
      <nav aria-label="Breadcrumb" className="mb-3">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
          <li>
            <Link href={routes.workspace(slug)} className="hover:text-ink link">
              {ctx.tenant.name}
            </Link>
          </li>
          {ancestors.map((ancestor) => (
            <li key={ancestor.id} className="flex items-center gap-1">
              <ChevronRight className="size-3 text-faint" aria-hidden />
              <Link href={routes.goal(slug, ancestor.id)} title={ancestor.title} className="max-w-48 truncate hover:text-ink link">
                {ancestor.title}
              </Link>
            </li>
          ))}
          <li className="flex min-w-0 items-center gap-1">
            <ChevronRight className="size-3 text-faint" aria-hidden />
            <span aria-current="page" title={goal.title} className="max-w-64 truncate text-ink-2">
              {goal.title}
            </span>
          </li>
        </ol>
      </nav>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-2xl font-bold text-ink">{goal.title}</h1>
            <MetaBadge meta={GOAL_STATUS_META} value={goal.status} />
            <span className="text-xs text-muted">
              View on{" "}
              <Link href={routes.board(slug, goal.id)} className="font-semibold text-ink-2 link">
                board
              </Link>{" "}
              ·{" "}
              <Link href={routes.timeline(slug, { goal: goal.id })} className="font-semibold text-ink-2 link">
                timeline
              </Link>
            </span>
          </div>
          {goal.description && <p className="mt-1.5 max-w-3xl text-sm whitespace-pre-line text-ink-2">{goal.description}</p>}
          <p className="mt-2 flex items-center gap-1 text-xs text-muted">
            <CreatorIcon className="size-3" aria-hidden />
            {goal.status === "proposed" ? "Proposed" : "Created"} by {goal.createdByName} {timeAgo(goal.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditGoals && (
            <Popover icon={<Pencil aria-hidden />} label="Edit" variant="ghost" title="Edit goal">
              <EditGoalForm slug={slug} goal={goal} goals={goals} />
            </Popover>
          )}
          {canDecide && <GoalStatusActions goalId={goal.id} status={goal.status} slug={slug} size="sm" openTasks={goal.rollup.open} />}
        </div>
      </div>

      <StatStrip className="mb-6 grid-cols-2 sm:grid-cols-4 lg:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))]">
        <FlowStat
          label="Tasks by status"
          caption={goal.childCount > 0 ? `This goal and ${pluralize(subGoals.length, "sub-goal")}` : undefined}
          figure={`${percent(goal.progress)} done`}
          counts={goal.rollup}
          hrefFor={(status) => routes.tasksByStatus(slug, status, goal.id)}
        />
        <Stat label="Open" value={goal.rollup.open} hint={`of ${pluralize(goal.rollup.total, "task")}`} />
        <Stat label="Late" value={late} tone={late ? "danger" : undefined} hint="past due, still open" />
        <Stat label={`Done, last ${TIMETABLE_DAYS} days`} value={doneInWindow} tone={doneInWindow ? "success" : undefined} />
      </StatStrip>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Timetable"
              description={`Every task under this goal ${windowSpan(window, TIMETABLE_DAYS)}.`}
              action={
                <ButtonLink href={routes.timeline(slug, { goal: goal.id, days: String(TIMETABLE_DAYS) })} size="sm" variant="ghost">
                  Full timeline
                </ButtonLink>
              }
            />
            <CardBody>
              <Timetable
                window={window}
                groups={trackGroups}
                empty={
                  <EmptyState icon={<CalendarRange />} title="No tasks on the line">
                    Tasks under this goal appear here from the day they are captured.
                  </EmptyState>
                }
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Tasks"
              description={`${goal.own.open} open and ${goal.own.done} done directly under this goal.`}
              action={
                canWrite && (
                  <Popover variant="ghost" icon={<Plus aria-hidden />} label="Add task" title="Add a task">
                    <AddTaskForm slug={slug} goals={goals} goalId={goal.id} lockGoal />
                  </Popover>
                )
              }
            />
            <CardBody className="py-1">
              {tasks.length === 0 ? (
                <EmptyState icon={<ListTodo />} title="No tasks yet">
                  Agents file tasks here as they triage. Ask one to break this goal down with plan_goal.
                </EmptyState>
              ) : (
                <ul>
                  {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} slug={slug} canWrite={canWrite} showGoal={false} goals={goals} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Sub-goals"
              action={
                canEditGoals &&
                goal.depth < GOAL_MAX_DEPTH - 1 && (
                  <Popover variant="ghost" icon={<Plus aria-hidden />} label="Add sub-goal" title="Add a sub-goal">
                    <NewGoalForm slug={slug} goals={goals} parentGoalId={goal.id} />
                  </Popover>
                )
              }
            />
            <CardBody className="py-1">
              {subGoals.length === 0 ? (
                <p className="py-3 text-sm text-muted">No sub-goals yet. Split a big goal into milestones and its progress rolls up.</p>
              ) : (
                <GoalTree goals={subGoals} slug={slug} baseDepth={goal.depth + 1} />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title="Memory"
              description="What agents know about this goal."
              action={
                can(ctx.actor, "memory:write") && (
                  <Popover variant="ghost" icon={<Plus aria-hidden />} label="Add" title="Remember something">
                    <RememberForm slug={slug} goals={goals} goalId={goal.id} />
                  </Popover>
                )
              }
            />
            <CardBody className="py-1">
              {memories.length === 0 ? (
                <p className="py-3 text-sm text-muted">No memories about this goal yet.</p>
              ) : (
                <MemoryList memories={memories} slug={slug} canWrite={can(ctx.actor, "memory:write")} />
              )}
            </CardBody>
          </Card>
          {documents.length > 0 && (
            <Card>
              <CardHeader title="Documents" description="Attached to this goal; documents on its tasks show on each task." />
              <CardBody>
                <DocumentChips documents={documents} slug={slug} max={20} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <ActivityFeed events={activity} slug={slug} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
