import type { Metadata } from "next";

import { AnsweredDecisions } from "@/components/answered-decisions";
import { OpenQuestions } from "@/components/open-questions";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { pluralize } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { can } from "@/server/domain/policy";
import { listDecisions } from "@/server/domain/tasks";

export const metadata: Metadata = { title: "Decisions" };

export default async function DecisionsPage({ params }: PageProps<"/w/[slug]/decisions">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const { open, closed } = await listDecisions(ctx, {});
  const canAnswer = can(ctx.actor, "task:write");
  const decisions = open.filter((task) => task.inputRequest?.kind === "decision").length;

  return (
    <>
      <PageHeader
        title="Decisions"
        description="Everything agents asked you to decide or answer. Pick an option or write your answer; an agent that is waiting picks it up at once, others the next time they check in."
      />
      <div className="space-y-6">
        <Card id="questions" tone={open.length ? "wait" : "plain"}>
          <CardHeader
            tone={open.length ? "wait" : "plain"}
            title={open.length ? `${pluralize(open.length, "request")} waiting on you` : "Nothing waiting on you"}
            description={
              open.length
                ? `${[decisions && pluralize(decisions, "decision"), open.length - decisions && pluralize(open.length - decisions, "question")].filter(Boolean).join(" and ")}, longest waiting first.`
                : "When an agent needs your call, it shows up here with its context and links."
            }
          />
          {open.length > 0 && (
            <CardBody className="py-1">
              <OpenQuestions tasks={open} slug={slug} canAnswer={canAnswer} showGoal />
            </CardBody>
          )}
        </Card>
        <Card>
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
