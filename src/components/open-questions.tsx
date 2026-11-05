import { Bot, Check, Ellipsis } from "lucide-react";
import Link from "next/link";

import { answerInputAction, retractAnswerAction } from "@/app/w/[slug]/actions";
import { sessionOfAsker, type AgentSession, type InputRequest } from "@/lib/agent-sessions";
import { LIMITS, REQUEST_KIND_META } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { timeAgo, truncate } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { TaskView } from "@/server/domain/tasks";

import { ResumeLink, ResumePopover, TaskLinks } from "./agent-sessions";
import { DecisionKeys } from "./decision-keys";
import { DocumentChips } from "./documents/document-chips";
import { GoalLink } from "./goal-link";
import { ActionButton } from "./ui/action-button";
import { ActionForm } from "./ui/action-form";
import { MetaBadge } from "./ui/badge";
import { CountedTextarea } from "./ui/counted-textarea";
import { Field } from "./ui/field";
import { Popover, PopoverCancel } from "./ui/popover";
import type { UndoSpec } from "./ui/status-region";
import { SubmitButton } from "./ui/submit-button";

/** Taking the answer back reopens the question, until the agent has collected it. */
const takeBack = (taskId: string, request: InputRequest): UndoSpec => ({
  action: retractAnswerAction,
  fields: { taskId, requestId: request.id },
  done: `${request.agentName}'s question is open again.`,
});

/** What the status region says once an answer is sent: the receipt a person checks. */
const sent = (answer: string, request: InputRequest) => `Sent “${truncate(answer, 60)}” to ${request.agentName}`;

/** A short reply, written here; the panel repeats the question so it stays in view while typing. */
function OtherAnswer({ taskId, slug, request }: { taskId: string; slug: string; request: InputRequest }) {
  const field = `answer-${taskId}`;
  const decision = request.kind === "decision";
  return (
    <Popover
      label={request.options.length ? "Other answer" : decision ? "Decide here" : "Answer here"}
      variant="secondary"
      align="left"
      phone="inline"
      title={decision ? "Your decision" : "Your answer"}
    >
      <ActionForm action={answerInputAction} workspace={slug} className="space-y-3" notice={`Sent your answer to ${request.agentName}`} undo={takeBack(taskId, request)} closeOnSuccess>
        <input type="hidden" name="taskId" value={taskId} />
        <p className="line-clamp-2 border-l-2 border-wait pl-2.5 text-xs text-ink-2">{request.question}</p>
        <Field label={decision ? "Decision" : "Answer"} htmlFor={field} hint={`${request.agentName} gets this right away.`}>
          <CountedTextarea id={field} name="answer" required maxLength={LIMITS.note} />
        </Field>
        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="primary">
            Send
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}

/** Rarer moves, behind ⋯: saying it was answered in the agent's own conversation. */
function MoreAnswers({ taskId, slug, request, title }: { taskId: string; slug: string; request: InputRequest; title: string }) {
  return (
    <Popover menu variant="ghost" label={<Ellipsis aria-hidden />} triggerLabel={`More for ${title}`} triggerClassName="px-2">
      <ActionButton
        action={answerInputAction}
        workspace={slug}
        fields={{ taskId }}
        confirm={`Mark ${request.agentName}'s question answered? Do this only if you answered it in their conversation.`}
        notice={`Marked ${request.agentName}'s question answered`}
        undo={takeBack(taskId, request)}
        closeOnSuccess
        size="menu"
        variant="ghost"
      >
        <Check aria-hidden />
        Answered in the conversation
      </ActionButton>
    </Popover>
  );
}

/**
 * The request's options, first and largest, as one-click answers; on phones they stack as
 * full-width capsules. Each shows its number key.
 */
function OptionButtons({ taskId, slug, request }: { taskId: string; slug: string; request: InputRequest }) {
  return request.options.map((option, index) => (
    <ActionButton
      key={option}
      action={answerInputAction}
      workspace={slug}
      fields={{ taskId, answer: option }}
      notice={sent(option, request)}
      undo={takeBack(taskId, request)}
      data-option={index < 9 ? String(index + 1) : undefined}
      aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
      variant="tinted"
      className="max-sm:w-full"
    >
      {index < 9 && (
        <kbd aria-hidden className="hidden h-5 min-w-5 items-center justify-center rounded-xs bg-panel/70 px-1 font-sans text-2xs pointer-fine:inline-flex">
          {index + 1}
        </kbd>
      )}
      {option}
    </ActionButton>
  ));
}

/** The way back into the asking agent's session: primary for a plain question, a quiet link after a decision's options. */
function Resume({ session, prominent }: { session: AgentSession | undefined; prominent: boolean }) {
  if (!session) return null;
  return prominent && session.url ? <ResumeLink session={session} variant="primary" /> : <ResumePopover sessions={[session]} />;
}

/**
 * Questions and decisions agents asked, longest waiting first. A decision leads with its options,
 * directly under the question; a plain question leads with the way back into the asking agent's
 * session, where the answer is quickest. Each entry is `#task-<id>`, so a link can land on it.
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
  const list = (
    <ul>
      {tasks.map((task) => {
        const request = task.inputRequest!;
        const session = sessionOfAsker(task.agentSessions, request);
        const options = canAnswer && request.options.length > 0;
        return (
          <li
            key={task.id}
            id={`task-${task.id}`}
            data-task={task.id}
            data-entry
            tabIndex={-1}
            aria-label={task.title}
            className={cx(
              "relative -mx-3 scroll-mt-32 rounded-md border-b border-rule px-3 py-3.5 outline-none last:border-b-0 motion-safe:transition-colors motion-safe:duration-(--dur-micro)",
              // Selected (it holds focus, or J and K moved to it): an accent bar, a tint and a ring, never a hue alone.
              "before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-transparent",
              "data-selected:bg-accent-tint/45 data-selected:before:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {request.kind === "decision" && <MetaBadge meta={REQUEST_KIND_META} value={request.kind} />}
              <p className="text-sm font-semibold text-ink">
                <Link href={routes.task(slug, task.id)} scroll={false} data-task-link className="hover:underline hover:underline-offset-2">
                  {task.title}
                </Link>
              </p>
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
            {options ? (
              <>
                <div
                  role="group"
                  aria-label={`Answer ${task.title}`}
                  className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-2 max-sm:[&>form:has([data-option])]:basis-full"
                >
                  <OptionButtons taskId={task.id} slug={slug} request={request} />
                  <OtherAnswer taskId={task.id} slug={slug} request={request} />
                  <span className="ml-1.5">
                    <Resume session={session} prominent={false} />
                  </span>
                  <MoreAnswers taskId={task.id} slug={slug} request={request} title={task.title} />
                </div>
                {request.context && <p className="mt-2.5 text-sm whitespace-pre-line text-ink-2">{request.context}</p>}
                <TaskLinks links={request.links} className="mt-2.5" />
                <DocumentChips documents={task.documents} slug={slug} className="mt-2" />
              </>
            ) : (
              <>
                {request.context && <p className="mt-2 text-sm whitespace-pre-line text-ink-2">{request.context}</p>}
                <TaskLinks links={request.links} className="mt-2.5" />
                <DocumentChips documents={task.documents} slug={slug} className="mt-2" />
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Resume session={session} prominent />
                  {canAnswer && <OtherAnswer taskId={task.id} slug={slug} request={request} />}
                  {canAnswer && <MoreAnswers taskId={task.id} slug={slug} request={request} title={task.title} />}
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
  return canAnswer ? <DecisionKeys>{list}</DecisionKeys> : list;
}
