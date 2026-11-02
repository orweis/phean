import { Bot, CalendarClock, Plus } from "lucide-react";

import { ActivityFeed } from "@/components/activity-feed";
import { AgentWorkload } from "@/components/agent-list";
import { CumulativeFlow } from "@/components/charts/cumulative-flow";
import { FlowLegend } from "@/components/charts/flow-bar";
import { GoalTree } from "@/components/goal-tree";
import { NewGoalForm } from "@/components/goal-forms";
import { PageHeader } from "@/components/page-header";
import { PendingApprovals } from "@/components/pending-approvals";
import { TaskRow } from "@/components/task-card";
import { TodayStrip } from "@/components/today-strip";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/stat";
import { formatDueDate, pluralize, relativeDue } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cumulativeFlow } from "@/lib/timeline";
import { requireWorkspace } from "@/server/auth/session";
import { listActivity } from "@/server/domain/events";
import { listGoals } from "@/server/domain/goals";
import { getAgentWorkload, getJourneys, getStatusSummary, type WorkspaceStats } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";

const list = new Intl.ListFormat("en", { type: "conjunction" });

/** The one sentence an owner needs first: what waits on them, what is late, how much is moving. */
function statusSentence(stats: WorkspaceStats): string {
  const parts = [
    stats.pendingApprovals > 0 && `${pluralize(stats.pendingApprovals, "goal")} ${stats.pendingApprovals === 1 ? "awaits" : "await"} your decision`,
    stats.overdue > 0 && `${pluralize(stats.overdue, "task")} ${stats.overdue === 1 ? "is" : "are"} late`,
    stats.openTasks > 0 && `${pluralize(stats.openTasks, "task")} ${stats.openTasks === 1 ? "is" : "are"} open`,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? `${list.format(parts).replace(/^./, (first) => first.toUpperCase())}.` : "Nothing is waiting on you.";
}

function DueLead({ dueDate, late }: { dueDate: string; late?: boolean }) {
  return (
    <>
      <span className="block text-md font-bold font-stretch-condensed text-ink">{formatDueDate(dueDate)}</span>
      <span className={late ? "text-xs font-semibold text-late-ink" : "text-xs text-muted"}>{relativeDue(dueDate)}</span>
    </>
  );
}

export default async function DashboardPage({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const [summary, goals, activity, workload, { window, journeys }] = await Promise.all([
    getStatusSummary(ctx, {}),
    listGoals(ctx, {}),
    listActivity(ctx, { limit: 30 }),
    getAgentWorkload(ctx, {}),
    getJourneys(ctx, { days: 14 }),
  ]);
  const proposed = goals.filter((goal) => goal.status === "proposed");
  const canWrite = can(ctx.actor, "task:write");
  const newGoal = can(ctx.actor, "goal:write") && (
    <Popover
      label={
        <>
          <Plus aria-hidden />
          New goal
        </>
      }
    >
      <NewGoalForm slug={slug} goals={goals} />
    </Popover>
  );

  return (
    <>
      <PageHeader
        title={ctx.tenant.name}
        description={statusSentence(summary)}
        actions={
          workload.length === 0 && can(ctx.actor, "agent:manage") ? (
            <ButtonLink href={routes.agents(slug)} variant="primary">
              <Bot aria-hidden />
              Connect an agent
            </ButtonLink>
          ) : (
            newGoal
          )
        }
      />

      <TodayStrip stats={summary} slug={slug} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {proposed.length > 0 && (
            <Card tone="wait">
              <CardHeader
                tone="wait"
                title={`${pluralize(proposed.length, "goal")} awaiting your decision`}
                description="Agents can propose goals; only people can approve them."
              />
              <CardBody className="py-1">
                <PendingApprovals goals={proposed} slug={slug} canDecide={can(ctx.actor, "goal:decide")} />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="How the work moved"
              description="Tasks at each status at the end of each day, over the last 14 days."
              action={
                <ButtonLink href={routes.timeline(slug)} size="sm" variant="ghost">
                  Open timeline
                </ButtonLink>
              }
            />
            <CardBody>
              <CumulativeFlow flow={cumulativeFlow(journeys, window)} />
              <FlowLegend className="mt-4" stations={["inbox", "todo", "in_progress", "done"]} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Coming due"
              description="Open tasks with a due date, soonest first."
              action={
                <ButtonLink href={routes.board(slug)} size="sm" variant="ghost">
                  Open board
                </ButtonLink>
              }
            />
            <CardBody className="py-1">
              {summary.dueSoonTasks.length === 0 ? (
                <EmptyState icon={<CalendarClock />} title="Nothing coming due">
                  Tasks with a due date show up here, soonest first.
                </EmptyState>
              ) : (
                <ul>
                  {summary.dueSoonTasks.map((task) => (
                    <TaskRow key={task.id} task={task} slug={slug} canWrite={canWrite} lead={<DueLead dueDate={task.dueDate!} />} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Goal map" description="Each goal with its tasks by status, rolled up from its sub-goals." action={newGoal} />
            <CardBody className="py-1">
              <GoalTree
                goals={goals.filter((goal) => goal.status !== "proposed")}
                slug={slug}
                empty={
                  proposed.length > 0
                    ? { title: "No approved goals yet", hint: "Approve a proposed goal above and it will show up here with its progress." }
                    : undefined
                }
              />
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {summary.overdueTasks.length > 0 && (
            <Card tone="late">
              <CardHeader tone="late" title="Late" description="Past their due date and still open." />
              <CardBody className="py-1">
                <ul>
                  {summary.overdueTasks.map((task) => (
                    <TaskRow key={task.id} task={task} slug={slug} canWrite={canWrite} lead={<DueLead dueDate={task.dueDate!} late />} />
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader
              title="Agents"
              description="What each holds now and finished this week."
              action={
                <ButtonLink href={routes.agents(slug)} size="sm" variant="ghost">
                  Manage
                </ButtonLink>
              }
            />
            <CardBody>
              <AgentWorkload loads={workload} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Activity" description="Humans and agents, newest first." />
            <CardBody className="max-h-[36rem] overflow-y-auto">
              <ActivityFeed events={activity} slug={slug} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
