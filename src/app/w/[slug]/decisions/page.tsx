import type { Metadata } from "next";

import { AnsweredDecisions } from "@/components/answered-decisions";
import { NotificationMute } from "@/components/notification-mute";
import { NotificationsPrompt } from "@/components/notifications-prompt";
import { OpenQuestions } from "@/components/open-questions";
import { PageHeader } from "@/components/page-header";
import { PendingApprovals } from "@/components/pending-approvals";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FocusOnLoad } from "@/components/ui/focus-on-load";
import { EmptyState } from "@/components/ui/stat";
import { DELIVERED_OUTCOMES } from "@/lib/agent-sessions";
import { pluralize } from "@/lib/format";
import { queryParam } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { vapidConfig } from "@/server/config";
import { listGoals } from "@/server/domain/goals";
import { isWorkspaceMuted } from "@/server/domain/notifications";
import { can } from "@/server/domain/policy";
import { findRequest, listDecisions, type DecisionRecord } from "@/server/domain/tasks";

export const metadata: Metadata = { title: "Decisions" };

/** The answered card in one line: how many were settled, of which kind, and how many their agents have yet to pick up. */
function answeredSummary(closed: readonly DecisionRecord[]): string {
  const decided = closed.filter(({ request }) => request.kind === "decision").length;
  const kinds = [decided && pluralize(decided, "decision"), closed.length - decided && pluralize(closed.length - decided, "question")].filter(Boolean).join(" and ");
  const delivered = closed.filter(({ request }) => DELIVERED_OUTCOMES.includes(request.outcome));
  const waiting = delivered.filter(({ request }) => !request.collected).length;
  const pickup = waiting ? ` ${waiting} not picked up by ${waiting === 1 ? "its agent" : "their agents"} yet.` : delivered.length ? " Every answer has reached its agent." : "";
  return `${kinds} settled.${pickup}`;
}

export default async function DecisionsPage({ params, searchParams }: PageProps<"/w/[slug]/decisions">) {
  const { slug } = await params;
  const focus = queryParam((await searchParams).focus);
  const { ctx } = await requireWorkspace(slug);
  const [{ open, closed }, goals, linked, muted] = await Promise.all([
    listDecisions(ctx, {}),
    listGoals(ctx, {}),
    // A link to one request: found wherever it is, even past the answers this page lists.
    focus ? findRequest(ctx, { requestId: focus }).catch(() => null) : null,
    // Only members get notifications, so only they have a mute.
    can(ctx.actor, "notify:subscribe") ? isWorkspaceMuted(ctx, {}) : null,
  ]);
  const linkedElsewhere = linked?.record && !closed.some(({ request }) => request.id === focus) ? linked.record : null;
  const canAnswer = can(ctx.actor, "task:write");
  const proposed = goals.filter((goal) => goal.status === "proposed");
  const decisions = open.filter((task) => task.inputRequest?.kind === "decision").length;

  return (
    <>
      <PageHeader
        title="Decisions"
        description="Everything agents asked you to decide, answer or approve. Pick an option or write your answer; an agent that is waiting picks it up at once, others the next time they check in. With a request focused, number keys pick its options and J and K move between requests. Notifications for new requests are turned on per device, here or from your Account page; muting stops this workspace's on all of them."
        actions={muted === null ? undefined : <NotificationMute slug={slug} workspaceName={ctx.tenant.name} muted={muted} />}
      />
      <FocusOnLoad id={focus} />
      <div className="space-y-6">
        {muted !== null && <NotificationsPrompt publicKey={vapidConfig()?.publicKey ?? null} member />}
        {focus && !linked && (
          <p role="status" className="surface rounded-lg border border-rule px-4 py-3 text-sm text-ink-2">
            That question or decision is not in this workspace. It may have been in a task that was deleted, or the link is mistyped.
          </p>
        )}
        {linkedElsewhere && (
          <Card id="linked">
            <CardHeader title="Linked answer" description="The answered request this link points to, from further back than the list below." />
            <CardBody className="py-1">
              <AnsweredDecisions records={[linkedElsewhere]} slug={slug} focus={focus} />
            </CardBody>
          </Card>
        )}
        {open.length > 0 || proposed.length === 0 ? (
          <Card id="questions" tone={open.length ? "wait" : "plain"}>
            <CardHeader
              tone={open.length ? "wait" : "plain"}
              divided={open.length > 0}
              title={open.length ? `${pluralize(open.length, "request")} waiting on you` : "Nothing waiting on you"}
              description={
                open.length
                  ? `${[decisions && pluralize(decisions, "decision"), open.length - decisions && pluralize(open.length - decisions, "question")].filter(Boolean).join(" and ")}, longest waiting first; snoozed ones wait at the back.`
                  : undefined
              }
            />
            {open.length > 0 ? (
              <CardBody className="py-1">
                <OpenQuestions tasks={open} slug={slug} canAnswer={canAnswer} showGoal focus={focus} />
              </CardBody>
            ) : (
              <CardBody className="pt-0">
                <EmptyState art="spot-boulder" title="All clear">
                  When an agent needs your call, it shows up here with its context and links.{" "}
                  {closed.length > 0 && (
                    <a href="#answered" className="font-semibold text-ink-2 link">
                      See what you decided
                    </a>
                  )}
                </EmptyState>
              </CardBody>
            )}
          </Card>
        ) : null}
        {proposed.length > 0 && (
          <Card id="approvals" tone="wait" className="scroll-mt-32">
            <CardHeader
              tone="wait"
              title={`${pluralize(proposed.length, "goal")} to approve`}
              description="Agents can propose goals; only people can approve them."
            />
            <CardBody className="py-1">
              <PendingApprovals goals={proposed} slug={slug} canDecide={can(ctx.actor, "goal:decide")} />
            </CardBody>
          </Card>
        )}
        <Card id="answered" className="scroll-mt-32">
          <CardHeader title="Answered" description="What was decided, newest first. Each is one line; open it for the full record, or open its task." />
          <CardBody className="py-1">
            {closed.length ? (
              <>
                <p className="border-b border-rule py-3 text-sm text-ink-2">{answeredSummary(closed)}</p>
                <AnsweredDecisions records={closed} slug={slug} focus={focus} />
              </>
            ) : (
              <p className="py-6 text-center text-sm text-muted">No answered questions yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
