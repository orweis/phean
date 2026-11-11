import { Bot, Check, ChevronDown, ChevronRight, Clock } from "lucide-react";
import Link from "next/link";

import { askerName, chosenOptions, DELIVERED_OUTCOMES, type InputAnswer } from "@/lib/agent-sessions";
import { cx } from "@/lib/cx";
import { REQUEST_KIND_META, REQUEST_OUTCOME_META } from "@/lib/domain";
import { pluralize, timeAgo, truncate } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { DecisionRecord } from "@/server/domain/tasks";

import { TaskLinks } from "./agent-sessions";
import { GoalLink } from "./goal-link";
import { MetaBadge } from "./ui/badge";

/** Whether the asking agent has the answer yet: what a person checks after deciding. */
function Delivery({ request }: { request: DecisionRecord["request"] }) {
  if (!DELIVERED_OUTCOMES.includes(request.outcome)) return null;
  return request.collected ? (
    <span className="inline-flex items-center gap-1 text-arrive-ink">
      <Check className="size-3" aria-hidden />
      {request.agentName} has it
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-wait-ink">
      <Clock className="size-3" aria-hidden />
      Waiting for {request.agentName} to pick it up
    </span>
  );
}

/** The options the agent offered, with the ones chosen ticked, so the history keeps why. */
function OfferedOptions({ request, chosen }: { request: InputAnswer; chosen: readonly string[] }) {
  return (
    <ul aria-label={request.multiple ? "Options offered, several could be picked" : "Options offered"} className="mt-2 flex flex-wrap gap-1.5">
      {request.options.map((option) => {
        const picked = chosen.includes(option);
        return (
          <li
            key={option}
            className={cx(
              "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs",
              picked ? "border-edge font-semibold text-ink" : "border-rule text-muted",
            )}
          >
            {picked && <Check className="size-3" aria-hidden />}
            {option}
            {picked && <span className="sr-only"> (chosen)</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The answer in a few words, for a collapsed row: the picks, or the start of what was written, or how it closed. */
function answerLine(request: InputAnswer): string {
  const chosen = chosenOptions(request);
  if (chosen.length) return chosen.join(", ");
  if (request.answer) return truncate(request.answer.replace(/\s+/g, " "), 80);
  return REQUEST_OUTCOME_META[request.outcome].label;
}

/** How many answered rows show before the rest fold under "Show earlier". */
const RECENT = 8;

/**
 * Questions and decisions that were settled, newest first. Each is one line (what was asked, what
 * was picked, when, and whether the agent has it) that opens to the full record: the question,
 * every option offered, the written answer and the links. Past the most recent few, the rest fold
 * under one "Show earlier" so the page stays about what waits.
 */
export function AnsweredDecisions({ records, slug }: { records: readonly DecisionRecord[]; slug: string }) {
  const recent = records.slice(0, RECENT);
  const earlier = records.slice(RECENT);
  return (
    <>
      <AnsweredList records={recent} slug={slug} />
      {earlier.length > 0 && (
        <details className="group/earlier border-t border-rule">
          <summary className="flex h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronDown aria-hidden className="size-4 transition-transform group-open/earlier:rotate-180" />
            <span className="group-open/earlier:hidden">Show {pluralize(earlier.length, "earlier answer")}</span>
            <span className="hidden group-open/earlier:inline">Hide earlier answers</span>
          </summary>
          <AnsweredList records={earlier} slug={slug} />
        </details>
      )}
    </>
  );
}

function AnsweredList({ records, slug }: { records: readonly DecisionRecord[]; slug: string }) {
  return (
    <ul>
      {records.map(({ task, request }) => {
        const chosen = chosenOptions(request);
        // What the person wrote beyond the options they picked, if anything.
        const written = !chosen.length || (request.choices && request.answer !== request.choices.join("; "));
        const answered = request.outcome === "answered" || request.outcome === "answered_elsewhere";
        return (
          <li key={`${task.id}:${request.id}`} data-task={task.id} className="border-b border-rule last:border-b-0">
            <details className="group/answer">
              <summary className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 py-3 [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden className="mt-0.5 size-4 text-muted transition-transform group-open/answer:rotate-90" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <MetaBadge meta={REQUEST_KIND_META} value={request.kind} />
                    <span className="text-sm font-semibold text-ink">{request.question}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
                    <span className={cx("font-semibold", answered ? "text-ink-2" : "text-muted")}>
                      {answered && <Check className="mr-0.5 inline size-3" aria-hidden />}
                      {answerLine(request)}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{task.title}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={request.closedAt}>{timeAgo(request.closedAt)}</time>
                    <Delivery request={request} />
                  </span>
                </span>
              </summary>
              <div className="pb-4 pl-6">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <MetaBadge meta={REQUEST_OUTCOME_META} value={request.outcome} />
                  <span className="inline-flex items-center gap-1">
                    <Bot className="size-3" aria-hidden />
                    {askerName(request)} asked {timeAgo(request.askedAt)}
                  </span>
                  {task.goalId && task.goalTitle && (
                    <>
                      <span aria-hidden>·</span>
                      <GoalLink slug={slug} goalId={task.goalId} title={task.goalTitle} />
                    </>
                  )}
                </p>
                {request.options.length > 0 && <OfferedOptions request={request} chosen={chosen} />}
                {request.answer && written && (
                  <p className="mt-2 rounded-md bg-fill px-3 py-2 text-sm whitespace-pre-line text-ink">
                    <span className="font-semibold">{request.answeredByName ?? "Answer"}:</span> {request.answer}
                  </p>
                )}
                <p className="mt-2 text-xs text-muted">
                  <time dateTime={request.closedAt}>
                    {answered
                      ? `Answered ${timeAgo(request.closedAt)}${request.answeredByName ? ` by ${request.answeredByName}` : ""}`
                      : `Closed ${timeAgo(request.closedAt)}`}
                  </time>
                </p>
                <TaskLinks links={request.links} className="mt-2" />
                <Link href={routes.task(slug, task.id)} scroll={false} className="mt-2 inline-block text-xs font-semibold link">
                  Open “{truncate(task.title, 60)}”
                </Link>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
