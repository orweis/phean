import { Bot, CalendarRange, ListTodo, Mail } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ActivityFeed } from "@/components/activity-feed";
import { AgentWorkload } from "@/components/agent-list";
import { Timetable, TimetableLegend } from "@/components/charts/timetable";
import { GoalTree } from "@/components/goal-tree";
import { HandoffList } from "@/components/handoffs";
import { ManualEntry } from "@/components/manual-entry";
import { OpenQuestions } from "@/components/open-questions";
import { PageHeader } from "@/components/page-header";
import { PendingApprovals } from "@/components/pending-approvals";
import { TaskPointer, TaskRow } from "@/components/task-card";
import { TodayStrip } from "@/components/today-strip";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import { journeyTotals, mostPressing } from "@/lib/timeline";
import { requireWorkspace } from "@/server/auth/session";
import { listActivity } from "@/server/domain/events";
import { listGoals } from "@/server/domain/goals";
import { getAgentWorkload, getJourneys, getStatusSummary, type WorkspaceStats } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { listHandoffs, suggestNextActions } from "@/server/domain/tasks";

const NEXT_ACTIONS = 6;
/** Tracks the overview's timetable draws; the Timeline tab has the rest. */
const PRESSING_TRACKS = 8;

/** Up to this many waiting items share one "Waiting on you" card; more get a card each. */
const MERGED_WAITING = 3;

const list = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * The one sentence an owner needs first: what waits on them, what is late, how much is moving.
 * Each clause links to the card that holds it.
 */
function statusSentence(stats: WorkspaceStats, slug: string): ReactNode {
  const parts = [
    stats.awaitingInput > 0 && {
      href: "#questions",
      text: `${pluralize(stats.awaitingInput, "agent question")} ${stats.awaitingInput === 1 ? "awaits" : "await"} your answer`,
    },
    stats.pendingApprovals > 0 && {
      href: "#approvals",
      text: `${pluralize(stats.pendingApprovals, "goal")} ${stats.pendingApprovals === 1 ? "awaits" : "await"} your approval`,
    },
    stats.overdue > 0 && { href: "#late", text: `${pluralize(stats.overdue, "task")} ${stats.overdue === 1 ? "is" : "are"} late` },
    stats.openTasks > 0 && { href: routes.board(slug), text: `${pluralize(stats.openTasks, "task")} ${stats.openTasks === 1 ? "is" : "are"} open` },
  ].filter((part): part is { href: string; text: string } => Boolean(part));
  if (parts.length === 0) return "Nothing is waiting on you.";
  const words = list.formatToParts(parts.map((part) => part.text));
  let clause = 0;
  return (
    <>
      {words.map((word, index) => {
        if (word.type === "literal") return <span key={index}>{word.value}</span>;
        const { href, text } = parts[clause++]!;
        const label = index === 0 ? text.replace(/^./, (first) => first.toUpperCase()) : text;
        return href.startsWith("#") ? (
          <a key={index} href={href} className="link">
            {label}
          </a>
        ) : (
          <Link key={index} href={href} className="link">
            {label}
          </Link>
        );
      })}
      .
    </>
  );
}

export default async function DashboardPage({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const [summary, goals, activity, workload, nextActions, { window, journeys }, handoffs] = await Promise.all([
    getStatusSummary(ctx, {}),
    listGoals(ctx, {}),
    listActivity(ctx, { limit: 30 }),
    getAgentWorkload(ctx, {}),
    // Tasks with an open question are already in the card above; ask for enough to fill the list without them.
    suggestNextActions(ctx, { limit: 20 }),
    getJourneys(ctx, { days: 14 }),
    listHandoffs(ctx, {}),
  ]);
  const proposed = goals.filter((goal) => goal.status === "proposed");
  const pressing = mostPressing(journeys, PRESSING_TRACKS, window.now);
  const openTracks = journeyTotals(journeys, window).open;
  const canWrite = can(ctx.actor, "task:write");
  const connectFirst = workload.length === 0 && can(ctx.actor, "agent:connect");
  const asked = new Set(summary.awaitingInputTasks.map((task) => task.id));
  const actions = nextActions.filter((task) => !task.inputRequest).slice(0, NEXT_ACTIONS);
  const merged = summary.awaitingInputTasks.length > 0 && proposed.length > 0 && summary.awaitingInputTasks.length + proposed.length <= MERGED_WAITING;
  const questions = (
    <OpenQuestions tasks={summary.awaitingInputTasks} slug={slug} canAnswer={canWrite} />
  );
  const approvals = <PendingApprovals goals={proposed} slug={slug} canDecide={can(ctx.actor, "goal:decide")} />;

  return (
    <>
      <PageHeader
        title={ctx.tenant.name}
        description={statusSentence(summary, slug)}
        inlineActions={!connectFirst}
        actions={
          <>
            <ButtonLink href={routes.digest(slug)} variant="ghost" size="sm">
              <Mail aria-hidden />
              Morning digest
            </ButtonLink>
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
          {merged ? (
            <Card id="questions" tone="wait" className="scroll-mt-32 max-lg:order-1">
              <CardHeader
                tone="wait"
                title="Waiting on you"
                description={`${pluralize(summary.awaitingInput, "agent question")} and ${pluralize(proposed.length, "goal")} to approve.`}
                action={
                  <Link href={routes.decisions(slug)} className="text-xs font-semibold text-wait-ink link">
                    All decisions
                  </Link>
                }
              />
              <CardBody className="py-1">
                {questions}
                <div id="approvals" className="scroll-mt-32 border-t border-rule pt-3">
                  <h3 className="text-xs font-semibold text-wait-ink">Goals to approve</h3>
                  {approvals}
                </div>
              </CardBody>
            </Card>
          ) : (
            <>
              {summary.awaitingInputTasks.length > 0 && (
                <Card id="questions" tone="wait" className="scroll-mt-32 max-lg:order-1">
                  <CardHeader
                    tone="wait"
                    title={`${pluralize(summary.awaitingInput, "agent question")} waiting on you`}
                    description="Agents paused for your answer or decision. Pick an option, answer here, or resume the conversation where it stopped."
                    action={
                      <Link href={routes.decisions(slug)} className="text-xs font-semibold text-wait-ink link">
                        All decisions
                      </Link>
                    }
                  />
                  <CardBody className="py-1">{questions}</CardBody>
                </Card>
              )}
              {proposed.length > 0 && (
                <Card id="approvals" tone="wait" className="scroll-mt-32 max-lg:order-1">
                  <CardHeader
                    tone="wait"
                    title={`${pluralize(proposed.length, "goal")} to approve`}
                    description="Agents can propose goals; only people can approve them."
                  />
                  <CardBody className="py-1">{approvals}</CardBody>
                </Card>
              )}
            </>
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
                slug={slug}
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
                  Open tasks
                </ButtonLink>
              }
            />
            <CardBody className="py-1">
              {actions.length === 0 ? (
                <EmptyState icon={<ListTodo />} title="Nothing to do right now">
                  Tasks move here once they are triaged out of the inbox.
                </EmptyState>
              ) : (
                <ul>
                  {actions.map((task) => (
                    <TaskRow key={task.id} task={task} slug={slug} canWrite={canWrite} goals={goals} />
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
            <Card id="late" tone="late" className="scroll-mt-32 max-lg:order-2">
              <CardHeader tone="late" title="Late" description="Past their due date and still open." />
              <CardBody className="py-1">
                <ul>
                  {summary.overdueTasks.map((task) =>
                    asked.has(task.id) ? (
                      <TaskPointer key={task.id} task={task} href={`#task-${task.id}`}>
                        Also waiting on your {task.inputRequest?.kind === "decision" ? "decision" : "answer"}, above
                      </TaskPointer>
                    ) : (
                      <TaskRow key={task.id} task={task} slug={slug} canWrite={canWrite} goals={goals} compact />
                    ),
                  )}
                </ul>
              </CardBody>
            </Card>
          )}
          {handoffs.length > 0 && (
            <Card id="handoffs" className="scroll-mt-32 max-lg:order-2">
              <CardHeader
                title="Handoffs"
                description="Work passing between agents and people, yours first."
                action={
                  <ButtonLink href={routes.board(slug, { view: "table", handoff: "any" })} size="sm" variant="ghost">
                    See all
                  </ButtonLink>
                }
              />
              <CardBody className="py-1">
                <HandoffList tasks={handoffs} slug={slug} viewerId={ctx.actor.id} canWrite={canWrite} />
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
            <CardBody>
              <ActivityFeed events={activity} slug={slug} />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
