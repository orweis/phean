import { CheckCheck } from "lucide-react";
import type { Metadata } from "next";

import { AnsweredDecisions } from "@/components/answered-decisions";
import { OpenQuestions } from "@/components/open-questions";
import { PageHeader } from "@/components/page-header";
import { PendingApprovals } from "@/components/pending-approvals";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { pluralize } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals } from "@/server/domain/goals";
import { can } from "@/server/domain/policy";
import { listDecisions } from "@/server/domain/tasks";

export const metadata: Metadata = { title: "Decisions" };

export default async function DecisionsPage({ params }: PageProps<"/w/[slug]/decisions">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const [{ open, closed }, goals] = await Promise.all([listDecisions(ctx, {}), listGoals(ctx, {})]);
  const canAnswer = can(ctx.actor, "task:write");
  const proposed = goals.filter((goal) => goal.status === "proposed");
  const decisions = open.filter((task) => task.inputRequest?.kind === "decision").length;

  return (
    <>
      <PageHeader
        title="Decisions"
        description="Everything agents asked you to decide, answer or approve. Pick an option or write your answer; an agent that is waiting picks it up at once, others the next time they check in. With a request focused, number keys pick its options and J and K move between requests."
      />
      <div className="space-y-6">
        {open.length > 0 || proposed.length === 0 ? (
          <Card id="questions" tone={open.length ? "wait" : "plain"}>
            <CardHeader
              tone={open.length ? "wait" : "plain"}
              divided={open.length > 0}
              title={open.length ? `${pluralize(open.length, "request")} waiting on you` : "Nothing waiting on you"}
              description={
                open.length
                  ? `${[decisions && pluralize(decisions, "decision"), open.length - decisions && pluralize(open.length - decisions, "question")].filter(Boolean).join(" and ")}, longest waiting first.`
                  : undefined
              }
            />
            {open.length > 0 ? (
              <CardBody className="py-1">
                <OpenQuestions tasks={open} slug={slug} canAnswer={canAnswer} showGoal />
              </CardBody>
            ) : (
              <CardBody className="pt-0">
                <EmptyState icon={<CheckCheck />} title="All clear">
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
          <CardHeader title="Answered" description="What was decided, newest first, and whether the asking agent has picked it up." />
          <CardBody className="py-1">
            {closed.length ? (
              <AnsweredDecisions records={closed} slug={slug} />
            ) : (
              <p className="py-6 text-center text-sm text-muted">No answered questions yet.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
