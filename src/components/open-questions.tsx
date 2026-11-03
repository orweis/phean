import { Bot, Check } from "lucide-react";

import { answerInputAction } from "@/app/w/[slug]/actions";
import { sessionOfAsker, type InputRequest } from "@/lib/agent-sessions";
import { LIMITS, REQUEST_KIND_META } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import type { TaskView } from "@/server/domain/tasks";

import { ResumeLink, ResumePopover, TaskLinks } from "./agent-sessions";
import { GoalLink } from "./goal-link";
import { ActionButton } from "./ui/action-button";
import { ActionForm } from "./ui/action-form";
import { MetaBadge } from "./ui/badge";
import { Field, Textarea } from "./ui/field";
import { Popover } from "./ui/popover";
import { SubmitButton } from "./ui/submit-button";

function AnswerControls({ taskId, slug, request }: { taskId: string; slug: string; request: InputRequest }) {
  const field = `answer-${taskId}`;
  const decision = request.kind === "decision";
  return (
    <>
      <Popover label={request.options.length ? "Other answer" : decision ? "Decide here" : "Answer here"} variant="secondary">
        <ActionForm action={answerInputAction} workspace={slug} className="space-y-3">
          <input type="hidden" name="taskId" value={taskId} />
          <Field
            label={decision ? "Your decision" : "Your answer"}
            htmlFor={field}
            hint={`${request.agentName} collects it from Phean, or is woken by it if it is waiting.`}
          >
            <Textarea id={field} name="answer" required maxLength={LIMITS.note} />
          </Field>
          <SubmitButton size="sm" variant="primary">
            Save answer
          </SubmitButton>
        </ActionForm>
      </Popover>
      <ActionButton action={answerInputAction} workspace={slug} fields={{ taskId }} size="sm" variant="ghost">
        <Check aria-hidden />
        Mark answered
      </ActionButton>
    </>
  );
}

/** The request's options as one-click answers. */
function OptionButtons({ taskId, slug, options }: { taskId: string; slug: string; options: readonly string[] }) {
  return (
    <div role="group" aria-label="Answer with an option" className="mt-2.5 flex flex-wrap gap-1.5">
      {options.map((option) => (
        <ActionButton key={option} action={answerInputAction} workspace={slug} fields={{ taskId, answer: option }} size="sm" variant="tinted">
          {option}
        </ActionButton>
      ))}
    </div>
  );
}

/**
 * Questions and decisions agents asked, longest waiting first. Each leads with the way back into
 * the asking agent's session, where the answer is quickest; answering here suits a short reply or a
 * pick from the agent's options.
 */
export function OpenQuestions({
  tasks,
  slug,
  canAnswer,
  showGoal = false,
}: {
  tasks: readonly TaskView[];
  slug: string;
  canAnswer: boolean;
  showGoal?: boolean;
}) {
  return (
    <ul>
      {tasks.map((task) => {
        const request = task.inputRequest!;
        const session = sessionOfAsker(task.agentSessions, request);
        return (
          <li key={task.id} data-task={task.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-rule py-3.5 last:border-b-0">
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {request.kind === "decision" && <MetaBadge meta={REQUEST_KIND_META} value={request.kind} />}
                <p className="text-sm font-semibold text-ink">{task.title}</p>
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
                <Bot className="size-3" aria-hidden />
                {request.agentName} asked {timeAgo(request.askedAt)}
                {session?.app && ` in ${session.app}`}
                {showGoal && task.goalId && task.goalTitle && (
                  <>
                    <span aria-hidden> · </span>
                    <GoalLink slug={slug} goalId={task.goalId} title={task.goalTitle} />
                  </>
                )}
              </p>
              <blockquote className="mt-2 border-l-2 border-wait pl-3 text-sm text-ink">{request.question}</blockquote>
              {request.context && <p className="mt-2 text-sm whitespace-pre-line text-ink-2">{request.context}</p>}
              <TaskLinks links={request.links} className="mt-2.5" />
              {canAnswer && request.options.length > 0 && <OptionButtons taskId={task.id} slug={slug} options={request.options} />}
            </div>
            <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1.5">
              {session?.url ? <ResumeLink session={session} variant="primary" /> : session && <ResumePopover sessions={[session]} />}
              {canAnswer && <AnswerControls taskId={task.id} slug={slug} request={request} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
