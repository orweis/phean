import { Bot, Check, Clock } from "lucide-react";

import { chosenOptions, DELIVERED_OUTCOMES, type InputAnswer } from "@/lib/agent-sessions";
import { cx } from "@/lib/cx";
import { REQUEST_KIND_META, REQUEST_OUTCOME_META } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
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

/** Questions and decisions that were settled, newest first, with who answered and what. */
export function AnsweredDecisions({ records, slug }: { records: readonly DecisionRecord[]; slug: string }) {
  return (
    <ul>
      {records.map(({ task, request }) => {
        const chosen = chosenOptions(request);
        // What the person wrote beyond the options they picked, if anything.
        const written = !chosen.length || (request.choices && request.answer !== request.choices.join("; "));
        return (
        <li key={`${task.id}:${request.id}`} data-task={task.id} className="border-b border-rule py-3.5 last:border-b-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <MetaBadge meta={REQUEST_KIND_META} value={request.kind} />
            <MetaBadge meta={REQUEST_OUTCOME_META} value={request.outcome} />
            <p className="text-sm font-semibold text-ink">{task.title}</p>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
            <Bot className="size-3" aria-hidden />
            {request.agentName} asked {timeAgo(request.askedAt)}
            {task.goalId && task.goalTitle && (
              <>
                <span aria-hidden> · </span>
                <GoalLink slug={slug} goalId={task.goalId} title={task.goalTitle} />
              </>
            )}
          </p>
          <blockquote className="mt-2 border-l-2 border-rule pl-3 text-sm text-ink-2">{request.question}</blockquote>
          {request.options.length > 0 && <OfferedOptions request={request} chosen={chosen} />}
          {request.answer && written && (
            <p className="mt-2 rounded-md bg-fill px-3 py-2 text-sm whitespace-pre-line text-ink">
              <span className="font-semibold">{request.answeredByName ?? "Answer"}:</span> {request.answer}
            </p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <time dateTime={request.closedAt}>
              {request.outcome === "answered" || request.outcome === "answered_elsewhere"
                ? `Answered ${timeAgo(request.closedAt)}${request.answeredByName ? ` by ${request.answeredByName}` : ""}`
                : `Closed ${timeAgo(request.closedAt)}`}
            </time>
            <Delivery request={request} />
          </p>
          <TaskLinks links={request.links} className="mt-2" />
        </li>
        );
      })}
    </ul>
  );
}
