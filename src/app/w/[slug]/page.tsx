import { Activity, AlertTriangle, Bot, ListTodo, Plus, Target } from "lucide-react";

import { ActivityFeed } from "@/components/activity-feed";
import { AgentList } from "@/components/agent-list";
import { GoalTree } from "@/components/goal-tree";
import { NewGoalForm } from "@/components/goal-forms";
import { PageHeader } from "@/components/page-header";
import { PendingApprovals } from "@/components/pending-approvals";
import { TaskCard } from "@/components/task-card";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { EmptyState, Stat } from "@/components/ui/stat";
import { pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listAgents } from "@/server/domain/agents";
import { listActivity } from "@/server/domain/events";
import { listGoals } from "@/server/domain/goals";
import { getStatusSummary } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { suggestNextActions } from "@/server/domain/tasks";

export default async function DashboardPage({ params }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const [summary, goals, nextActions, activity, agents] = await Promise.all([
    getStatusSummary(ctx, {}),
    listGoals(ctx, {}),
    suggestNextActions(ctx, { limit: 6 }),
    listActivity(ctx, { limit: 40 }),
    listAgents(ctx, {}),
  ]);
  const proposed = goals.filter((goal) => goal.status === "proposed");
  const canWrite = can(ctx.actor, "task:write");
  const liveAgents = agents.filter((agent) => !agent.revokedAt);

  return (
    <>
      <PageHeader
        title={ctx.tenant.name}
        description="What your agents are working on, what needs a decision, and what is slipping."
        actions={
          liveAgents.length === 0 &&
          can(ctx.actor, "agent:manage") && (
            <ButtonLink href={routes.agents(slug)} variant="primary">
              <Bot aria-hidden />
              Connect an agent
            </ButtonLink>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open tasks" value={summary.openTasks} href={routes.board(slug)} />
        <Stat label="Inbox" value={summary.inbox} hint="waiting for triage" tone={summary.inbox > 10 ? "warning" : undefined} href={routes.board(slug)} />
        <Stat label="Overdue" value={summary.overdue} tone={summary.overdue ? "danger" : undefined} />
        <Stat label="Due this week" value={summary.dueThisWeek} />
        <Stat label="Done, last 7 days" value={summary.doneLast7Days} tone={summary.doneLast7Days ? "success" : undefined} />
        <Stat label="Active agents" value={summary.activeAgents} hint={`of ${summary.agents} connected`} href={routes.agents(slug)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {proposed.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/40">
              <CardHeader
                title={`${pluralize(proposed.length, "goal")} awaiting your approval`}
                description="Agents can propose goals; only people can approve them."
                icon={<AlertTriangle className="text-amber-500" />}
              />
              <CardBody className="py-1">
                <PendingApprovals goals={proposed} slug={slug} canDecide={can(ctx.actor, "goal:decide")} />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Goals"
              description="Progress rolls up from sub-goals."
              icon={<Target />}
              action={
                can(ctx.actor, "goal:write") && (
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
                )
              }
            />
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

          <Card>
            <CardHeader
              title="Next actions"
              description="Most urgent first: priority, then due date, then age."
              icon={<ListTodo />}
              action={
                <ButtonLink href={routes.board(slug)} size="sm" variant="ghost">
                  Open board
                </ButtonLink>
              }
            />
            <CardBody>
              {nextActions.length === 0 ? (
                <EmptyState icon={<ListTodo />} title="Nothing to do right now">
                  Tasks move here once they are triaged out of the inbox.
                </EmptyState>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {nextActions.map((task) => (
                    <TaskCard key={task.id} task={task} slug={slug} canWrite={canWrite} />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {summary.overdueTasks.length > 0 && (
            <Card className="border-red-200">
              <CardHeader title="Overdue" icon={<AlertTriangle className="text-red-500" />} />
              <CardBody className="grid gap-2 sm:grid-cols-2">
                {summary.overdueTasks.map((task) => (
                  <TaskCard key={task.id} task={task} slug={slug} canWrite={canWrite} />
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Activity" description="Humans and agents, newest first." icon={<Activity />} />
            <CardBody className="max-h-[36rem] overflow-y-auto">
              <ActivityFeed events={activity} slug={slug} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Agents"
              icon={<Bot />}
              action={
                <ButtonLink href={routes.agents(slug)} size="sm" variant="ghost">
                  Manage
                </ButtonLink>
              }
            />
            <CardBody>
              {liveAgents.length === 0 ? (
                <EmptyState icon={<Bot />} title="No agents connected">
                  Issue a token on the Agents page and add Phean to your MCP client.
                </EmptyState>
              ) : (
                <AgentList agents={liveAgents} />
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
