import { Bot, Check } from "lucide-react";

import { answerInputAction } from "@/app/w/[slug]/actions";
import { sessionOfAsker } from "@/lib/agent-sessions";
import { LIMITS } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import type { TaskView } from "@/server/domain/tasks";

import { ResumeLink, ResumePopover } from "./agent-sessions";
import { ActionButton } from "./ui/action-button";
import { ActionForm } from "./ui/action-form";
import { Field, Textarea } from "./ui/field";
import { Popover } from "./ui/popover";
import { SubmitButton } from "./ui/submit-button";

function AnswerControls({ taskId, slug, agentName }: { taskId: string; slug: string; agentName: string }) {
  const field = `answer-${taskId}`;
  return (
    <>
      <Popover label="Answer here" variant="secondary">
        <ActionForm action={answerInputAction} workspace={slug} className="space-y-3">
          <input type="hidden" name="taskId" value={taskId} />
          <Field label="Your answer" htmlFor={field} hint={`Added to the task, where ${agentName} reads it the next time it checks in.`}>
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

/**
 * Questions agents asked, longest waiting first. Each leads with the way back into the asking
 * agent's session, where the answer is quickest; answering here suits a short reply.
 */
export function OpenQuestions({ tasks, slug, canAnswer }: { tasks: readonly TaskView[]; slug: string; canAnswer: boolean }) {
  return (
    <ul>
      {tasks.map((task) => {
        const request = task.inputRequest!;
        const session = sessionOfAsker(task.agentSessions, request);
        return (
          <li key={task.id} data-task={task.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-rule py-3.5 last:border-b-0">
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-sm font-semibold text-ink">{task.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
                <Bot className="size-3" aria-hidden />
                {request.agentName} asked {timeAgo(request.askedAt)}
                {session?.app && ` in ${session.app}`}
              </p>
              <blockquote className="mt-2 border-l-2 border-wait pl-3 text-sm text-ink">{request.question}</blockquote>
            </div>
            <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1.5">
              {session?.url ? <ResumeLink session={session} variant="primary" /> : session && <ResumePopover sessions={[session]} />}
              {canAnswer && <AnswerControls taskId={task.id} slug={slug} agentName={request.agentName} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
