import { Activity, Bot, Brain, ChevronRight, KanbanSquare, ListTodo, Pencil, Plus, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { ActivityFeed } from "@/components/activity-feed";
import { AddTaskForm } from "@/components/add-task-form";
import { EditGoalForm, NewGoalForm } from "@/components/goal-forms";
import { GoalStatusActions } from "@/components/goal-status-actions";
import { GoalTree } from "@/components/goal-tree";
import { MemoryList } from "@/components/memory-list";
import { RememberForm } from "@/components/remember-form";
import { TaskCard } from "@/components/task-card";
import { MetaBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { EmptyState, ProgressBar } from "@/components/ui/stat";
import { GOAL_MAX_DEPTH, GOAL_STATUS_META } from "@/lib/domain";
import { percent, pluralize, timeAgo } from "@/lib/format";
import { subtreeIds } from "@/lib/goal-tree";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals } from "@/server/domain/goals";
import { getGoalDetail } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { orNotFound } from "@/server/web";

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
  const [{ goal, ancestors, tasks, memories, activity }, goals] = await Promise.all([loadGoalDetail(slug, id), listGoals(ctx, {})]);
  const canWrite = can(ctx.actor, "task:write");
  const canDecide = can(ctx.actor, "goal:decide");
  const canEditGoals = can(ctx.actor, "goal:write");
  const below = new Set(subtreeIds(goals, goal.id));
  const subGoals = goals.filter((candidate) => candidate.id !== goal.id && below.has(candidate.id));
  const CreatorIcon = goal.createdByType === "agent" ? Bot : Target;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
        <Link href={routes.workspace(slug)} className="hover:text-zinc-900">
          Overview
        </Link>
        {ancestors.map((ancestor) => (
          <span key={ancestor.id} className="flex items-center gap-1">
            <ChevronRight className="size-3 text-zinc-300" aria-hidden />
            <Link href={routes.goal(slug, ancestor.id)} className="max-w-48 truncate hover:text-zinc-900">
              {ancestor.title}
            </Link>
          </span>
        ))}
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-zinc-900">{goal.title}</h1>
            <MetaBadge meta={GOAL_STATUS_META} value={goal.status} />
          </div>
          {goal.description && <p className="mt-1.5 max-w-3xl text-sm whitespace-pre-line text-zinc-600">{goal.description}</p>}
          <p className="mt-2 flex items-center gap-1 text-xs text-zinc-400">
            <CreatorIcon className="size-3" aria-hidden />
            {goal.status === "proposed" ? "Proposed" : "Created"} by {goal.createdByName} {timeAgo(goal.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditGoals && (
            <Popover
              label={
                <>
                  <Pencil aria-hidden />
                  Edit
                </>
              }
            >
              <EditGoalForm slug={slug} goal={goal} goals={goals} />
            </Popover>
          )}
          <ButtonLink href={routes.board(slug, goal.id)} size="sm">
            <KanbanSquare aria-hidden />
            Board
          </ButtonLink>
          {canDecide && <GoalStatusActions goalId={goal.id} status={goal.status} slug={slug} size="sm" />}
        </div>
      </div>

      {goal.status === "proposed" && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This goal is waiting for a decision. Approve it to let agents plan and work on it, or reject it to drop it.
        </p>
      )}

      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex min-w-60 flex-1 items-center gap-3">
            <ProgressBar value={goal.progress} className="flex-1" />
            <span className="text-sm font-semibold text-zinc-900 tabular-nums">{percent(goal.progress)}</span>
          </div>
          <p className="text-xs text-zinc-500">
            {goal.rollup.done} of {pluralize(goal.rollup.total, "task")} done
            {goal.childCount > 0 && ` across this goal and ${pluralize(subGoals.length, "sub-goal")}`}
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Tasks"
              description={`${goal.own.open} open, ${goal.own.done} done directly under this goal.`}
              icon={<ListTodo />}
            />
            <CardBody className="space-y-3">
              {canWrite && <AddTaskForm slug={slug} goals={goals} goalId={goal.id} lockGoal />}
              {tasks.length === 0 ? (
                <EmptyState icon={<ListTodo />} title="No tasks yet">
                  Add one above, or ask an agent to break this goal down with plan_goal.
                </EmptyState>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {tasks.map((task) => (
                    <TaskCard key={task.id} task={task} slug={slug} canWrite={canWrite} showGoal={false} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Sub-goals"
              icon={<Target />}
              action={
                canEditGoals &&
                goal.depth < GOAL_MAX_DEPTH - 1 && (
                  <Popover
                    label={
                      <>
                        <Plus aria-hidden />
                        Add sub-goal
                      </>
                    }
                  >
                    <NewGoalForm slug={slug} goals={goals} parentGoalId={goal.id} />
                  </Popover>
                )
              }
            />
            <CardBody className="py-1">
              {subGoals.length === 0 ? (
                <EmptyState icon={<Target />} title="No sub-goals">
                  Split big goals into milestones; progress rolls up automatically.
                </EmptyState>
              ) : (
                <GoalTree goals={subGoals} slug={slug} baseDepth={goal.depth + 1} />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Memory"
              description="What agents know about this goal."
              icon={<Brain />}
              action={
                can(ctx.actor, "memory:write") && (
                  <Popover
                    label={
                      <>
                        <Plus aria-hidden />
                        Add
                      </>
                    }
                  >
                    <RememberForm slug={slug} goals={goals} goalId={goal.id} />
                  </Popover>
                )
              }
            />
            <CardBody className="py-1">
              <MemoryList memories={memories} slug={slug} canWrite={can(ctx.actor, "memory:write")} empty="No memories about this goal" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Activity" icon={<Activity />} />
            <CardBody className="max-h-[32rem] overflow-y-auto">
              <ActivityFeed events={activity} slug={slug} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
