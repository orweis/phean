import { Bot, CalendarRange, ListTodo } from "lucide-react";

import { ActivityFeed } from "@/components/activity-feed";
import { AgentWorkload } from "@/components/agent-list";
import { mostPressing, Timetable, TimetableLegend } from "@/components/charts/timetable";
import { GoalTree } from "@/components/goal-tree";
import { ManualEntry } from "@/components/manual-entry";
import { PageHeader } from "@/components/page-header";
import { PendingApprovals } from "@/components/pending-approvals";
import { TaskRow } from "@/components/task-card";
import { TodayStrip } from "@/components/today-strip";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { isOpenTaskStatus } from "@/lib/domain";
import { formatDueDate, pluralize, relativeDue } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listActivity } from "@/server/domain/events";
import { listGoals } from "@/server/domain/goals";
import { getAgentWorkload, getJourneys, getStatusSummary, type WorkspaceStats } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { suggestNextActions } from "@/server/domain/tasks";

const NEXT_ACTIONS = 6;
/** Tracks the overview's timetable draws; the Timeline tab has the rest. */
const PRESSING_TRACKS = 8;

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
  const [summary, goals, activity, workload, nextActions, { window, journeys }] = await Promise.all([
    getStatusSummary(ctx, {}),
    listGoals(ctx, {}),
    listActivity(ctx, { limit: 30 }),
    getAgentWorkload(ctx, {}),
    suggestNextActions(ctx, { limit: NEXT_ACTIONS }),
    getJourneys(ctx, { days: 14 }),
  ]);
  const proposed = goals.filter((goal) => goal.status === "proposed");
  const pressing = mostPressing(journeys, PRESSING_TRACKS, window.now);
  const openTracks = journeys.filter(({ task }) => isOpenTaskStatus(task.status)).length;
  const canWrite = can(ctx.actor, "task:write");
  const connectFirst = workload.length === 0 && can(ctx.actor, "agent:manage");

  return (
    <>
      <PageHeader
        title={ctx.tenant.name}
        description={statusSentence(summary)}
        actions={
          <>
            <ManualEntry slug={slug} goals={goals} canAddTask={canWrite} canAddGoal={can(ctx.actor, "goal:write")} />
            {connectFirst && (
              <ButtonLink href={routes.agents(slug)} variant="primary">
                <Bot aria-hidden />
                Connect an agent
              </ButtonLink>
            )}
          </>
        }
      />

      <TodayStrip stats={summary} slug={slug} />

      {/* On phones both columns dissolve into one stack, ordered by what needs a person first. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 max-lg:contents lg:col-span-2 lg:space-y-6">
          {proposed.length > 0 && (
            <Card tone="wait" className="max-lg:order-1">
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

          <Card className="max-lg:order-3">
            <CardHeader
              title="On the line"
              description={
                pressing.length < openTracks
                  ? `The ${pressing.length} most pressing of ${openTracks} open tasks: late first, then by priority. A long flat run is stuck work.`
                  : "Every open task, from the day it was captured. A long flat run is stuck work."
              }
              action={
                <ButtonLink href={routes.timeline(slug)} size="sm" variant="ghost">
                  Open timeline
                </ButtonLink>
              }
            />
            <CardBody>
              {pressing.length > 0 && <TimetableLegend className="mb-4" />}
              <Timetable
                window={window}
                groups={pressing.length ? [{ key: "pressing", journeys: pressing }] : []}
                empty={
                  <EmptyState icon={<CalendarRange />} title="Nothing on the line">
                    Open tasks appear here from the day an agent captures them, with their due dates and the red line for now.
                  </EmptyState>
                }
              />
            </CardBody>
          </Card>

          <Card className="max-lg:order-4">
            <CardHeader
              title="Next actions"
              description="Most urgent first: priority, then due date, then age."
              action={
                <ButtonLink href={routes.board(slug)} size="sm" variant="ghost">
                  Open board
                </ButtonLink>
              }
            />
            <CardBody className="py-1">
              {nextActions.length === 0 ? (
                <EmptyState icon={<ListTodo />} title="Nothing to do right now">
                  Tasks move here once they are triaged out of the inbox.
                </EmptyState>
              ) : (
                <ul>
                  {nextActions.map((task) => (
                    <TaskRow key={task.id} task={task} slug={slug} canWrite={canWrite} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card className="max-lg:order-5">
            <CardHeader title="Goal map" description="Each goal with its tasks by status, rolled up from its sub-goals." />
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

        <div className="min-w-0 max-lg:contents lg:space-y-6">
          {summary.overdueTasks.length > 0 && (
            <Card tone="late" className="max-lg:order-2">
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
          <Card className="max-lg:order-6">
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
          <Card className="max-lg:order-7">
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
