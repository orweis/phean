import { Bot, CalendarClock, Check, CornerDownRight, Ellipsis, ListChecks, Trash2, Unlock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { completeTaskAction, releaseTaskAction, updateTaskAction } from "@/app/w/[slug]/actions";
import { webUrl } from "@/lib/agent-sessions";
import { cx } from "@/lib/cx";
import { isLate, isOpenTaskStatus, PRIORITY_META, SOURCE_META, TASK_STATUS_META, type TaskStatus } from "@/lib/domain";
import { formatDueDate, relativeDue, truncate } from "@/lib/format";
import type { TaskView } from "@/server/domain/tasks";

import { OutsideLink, QuestionNote, ResumePopover, TaskLinks, WaitingBadge } from "./agent-sessions";
import { EditTaskPopover } from "./edit-task-form";
import { GoalLink } from "./goal-link";
import type { GoalOption } from "./goal-options";
import { ActionButton } from "./ui/action-button";
import { MetaBadge } from "./ui/badge";
import { Popover } from "./ui/popover";
import type { UndoSpec } from "./ui/status-region";

/** The one-click next step for each status; "done" goes through complete so it is logged as completion. */
const NEXT_STEP: Partial<Record<TaskStatus, { label: string; status: TaskStatus; notice: (title: string) => string }>> = {
  inbox: { label: "Accept", status: "todo", notice: (title) => `Moved ${title} to To do` },
  todo: { label: "Start", status: "in_progress", notice: (title) => `Started ${title}` },
  in_progress: { label: "Done", status: "done", notice: (title) => `Done: ${title}` },
  done: { label: "Reopen", status: "todo", notice: (title) => `Reopened ${title}` },
  dropped: { label: "Restore", status: "todo", notice: (title) => `Restored ${title}` },
};

/** Fits two lines in the narrowest lane, so no clamped text sits hidden under the meta row. */
const CARD_EXCERPT = 80;

/** A task's title as the status region quotes it. */
const quoted = (task: TaskView) => `“${truncate(task.title, 60)}”`;

/** The move that puts a task back where it stood: complete it again, or set its old status. */
export function moveBack(task: Pick<TaskView, "id" | "status" | "title">, restored: string): UndoSpec {
  return task.status === "done"
    ? { action: completeTaskAction, fields: { taskId: task.id }, done: restored }
    : { action: updateTaskAction, fields: { taskId: task.id, status: task.status }, done: restored };
}

/** The next step, as the one prominent action of a task; the rest wait in its ⋯ menu. */
function NextStep({ task, slug }: { task: TaskView; slug: string }) {
  const next = NEXT_STEP[task.status];
  if (!next) return null;
  const taskId = task.id;
  const back = moveBack(task, `${quoted(task)} is back in ${TASK_STATUS_META[task.status].label}.`);
  return next.status === "done" ? (
    <ActionButton
      action={completeTaskAction}
      workspace={slug}
      fields={{ taskId }}
      notice={next.notice(quoted(task))}
      undo={back}
      exits
      pendingIcon={<Check className="motion-safe:animate-tick" aria-hidden />}
      size="sm"
      variant="tinted"
    >
      {next.label}
    </ActionButton>
  ) : (
    <ActionButton
      action={updateTaskAction}
      workspace={slug}
      fields={{ taskId, status: next.status }}
      notice={next.notice(quoted(task))}
      undo={back}
      size="sm"
      variant="tinted"
    >
      {next.label}
    </ActionButton>
  );
}

/**
 * Release and Drop, the rare moves, behind one ghost ⋯ that is always visible. Drop is undone
 * from the status region rather than confirmed, since it is frequent and fully reversible.
 */
function MoreActions({ task, slug }: { task: TaskView; slug: string }) {
  const taskId = task.id;
  const canDrop = isOpenTaskStatus(task.status);
  if (!task.claimedByName && !canDrop) return null;
  return (
    <Popover menu variant="ghost" label={<Ellipsis aria-hidden />} triggerLabel={`More actions for ${task.title}`} triggerClassName="px-2">
      {task.claimedByName && (
        <ActionButton
          action={releaseTaskAction}
          workspace={slug}
          fields={{ taskId }}
          notice={`Released ${quoted(task)} from ${task.claimedByName}`}
          closeOnSuccess
          size="menu"
          variant="ghost"
        >
          <Unlock aria-hidden />
          Release from {task.claimedByName}
        </ActionButton>
      )}
      {canDrop && (
        <ActionButton
          action={updateTaskAction}
          workspace={slug}
          fields={{ taskId, status: "dropped" }}
          notice={`Dropped ${quoted(task)}`}
          undo={moveBack(task, `Restored ${quoted(task)}.`)}
          exits
          closeOnSuccess
          size="menu"
          variant="ghost"
        >
          <Trash2 aria-hidden />
          Drop
        </ActionButton>
      )}
    </Popover>
  );
}

/** "From email", linked to the message itself when the agent recorded its link. */
function SourceLabel({ task }: { task: TaskView }) {
  const label = `From ${SOURCE_META[task.source].label.toLowerCase()}`;
  const href = webUrl(task.sourceRef);
  return href ? (
    <OutsideLink href={href} className="inline-flex items-center gap-0.5 hover:text-ink link [&_svg]:size-3">
      {label}
    </OutsideLink>
  ) : (
    <span>{label}</span>
  );
}

/** "Nov 2 · 2 days late", the due date as compact rows show it, inline with the title. */
function InlineDue({ dueDate, late }: { dueDate: string; late: boolean }) {
  return (
    <span className={cx("text-xs whitespace-nowrap", late ? "font-semibold text-late-ink" : "text-muted")}>
      {formatDueDate(dueDate)} · {relativeDue(dueDate)}
    </span>
  );
}

/** Goal, due date, source and claimant: the facts every task listing shows. */
function TaskMeta({ task, slug, showGoal, showDue = true }: { task: TaskView; slug: string; showGoal: boolean; showDue?: boolean }) {
  const late = isLate(task);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {task.inputRequest && <WaitingBadge slug={slug} kind={task.inputRequest.kind} taskId={task.id} />}
      {task.parentTitle && (
        <span className="inline-flex max-w-56 items-center gap-1" title={`Subtask of ${task.parentTitle}`}>
          <CornerDownRight className="size-3 shrink-0" aria-hidden />
          <span className="truncate">Subtask of {task.parentTitle}</span>
        </span>
      )}
      {showGoal && task.goalId && task.goalTitle && <GoalLink slug={slug} goalId={task.goalId} title={task.goalTitle} />}
      {task.subtaskCount > 0 && (
        <span className={cx("inline-flex items-center gap-1", task.subtasksDone === task.subtaskCount && "text-arrive-ink")}>
          <ListChecks className="size-3" aria-hidden />
          {task.subtasksDone} of {task.subtaskCount} subtasks done
        </span>
      )}
      {showDue && task.dueDate && (
        <span className={cx("inline-flex items-center gap-1", late && "font-semibold text-late-ink")}>
          <CalendarClock className="size-3" aria-hidden />
          {late ? `Late, due ${formatDueDate(task.dueDate)}` : `Due ${formatDueDate(task.dueDate)}`}
        </span>
      )}
      {task.source !== "manual" && <SourceLabel task={task} />}
      {task.claimedByName && (
        <span className="inline-flex items-center gap-1">
          <Bot className="size-3" aria-hidden />
          Held by {task.claimedByName}
        </span>
      )}
    </div>
  );
}

/** The title, with its priority right after the words, where the eye already is. */
function TaskTitle({ task, after }: { task: TaskView; after?: ReactNode }) {
  return (
    <p className={cx("text-sm font-semibold text-ink", task.status === "dropped" && "text-muted line-through")}>
      {task.title}
      {task.priority !== "medium" && (
        <span className="ml-1.5 inline-block align-[0.0625rem] no-underline">
          <MetaBadge meta={PRIORITY_META} value={task.priority} />
        </span>
      )}
      {after && <span className="ml-2 inline-block font-normal">{after}</span>}
    </p>
  );
}

interface TaskViewProps {
  task: TaskView;
  slug: string;
  canWrite: boolean;
  /** Hide the goal link when the task is already shown under its goal. */
  showGoal?: boolean;
  /** Goals the editor offers; without them, editing keeps the task's goal. */
  goals?: readonly GoalOption[];
}

/** Fades a row while the action that takes it off the screen runs (Done, Drop). */
const LEAVING = "has-[[data-exit][data-pending]]:opacity-40 motion-safe:transition-opacity motion-safe:duration-300";

/** The row of actions every task listing shares: the next step, Edit, Resume and ⋯, in that order. */
function TaskActionRow({ task, slug, canWrite, goals, className }: TaskViewProps & { className?: string }) {
  if (!canWrite && task.agentSessions.length === 0) return null;
  return (
    <div className={cx("flex items-center gap-x-3 gap-y-1.5", className)}>
      {canWrite && <NextStep task={task} slug={slug} />}
      {canWrite && <EditTaskPopover task={task} slug={slug} goals={goals ?? []} />}
      <ResumePopover sessions={task.agentSessions} />
      {canWrite && (
        <div className="ml-auto">
          <MoreActions task={task} slug={slug} />
        </div>
      )}
    </div>
  );
}

/** A task on a board lane. */
export function TaskCard({ task, slug, canWrite, showGoal = true, goals = [] }: TaskViewProps) {
  return (
    <article data-task={task.id} className={cx("rounded-md border bg-panel p-3", isLate(task) ? "border-late/45" : "border-rule", LEAVING)}>
      <TaskTitle task={task} />
      {task.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{truncate(task.description, CARD_EXCERPT)}</p>}
      <div className="mt-2">
        <TaskMeta task={task} slug={slug} showGoal={showGoal} />
      </div>
      <TaskLinks links={task.links} className="mt-2" />
      {task.inputRequest && <QuestionNote request={task.inputRequest} className="mt-2" />}
      <TaskActionRow task={task} slug={slug} canWrite={canWrite} goals={goals} className="mt-2.5" />
    </article>
  );
}

interface TaskRowProps extends TaskViewProps {
  /** A leading column such as the due date. */
  lead?: ReactNode;
  showDue?: boolean;
  /**
   * For a narrow rail: the due date inline after the title ("Nov 2 · 2 days late"), one meta line,
   * and the actions on their own line.
   */
  compact?: boolean;
}

/** A task as one line of a list, with an optional leading column such as its due date. */
export function TaskRow({ task, slug, canWrite, showGoal = true, goals = [], lead, showDue = !lead, compact = false }: TaskRowProps) {
  if (compact) {
    return (
      <li data-task={task.id} className={cx("border-b border-rule py-3 last:border-b-0", LEAVING)}>
        <TaskTitle task={task} after={task.dueDate && <InlineDue dueDate={task.dueDate} late={isLate(task)} />} />
        <div className="mt-1">
          <TaskMeta task={task} slug={slug} showGoal={showGoal} showDue={false} />
        </div>
        <TaskActionRow task={task} slug={slug} canWrite={canWrite} goals={goals} className="mt-2" />
      </li>
    );
  }
  return (
    <li data-task={task.id} className={cx("flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-rule py-3 last:border-b-0", LEAVING)}>
      {lead && <div className="w-20 shrink-0 max-sm:hidden">{lead}</div>}
      <div className="min-w-0 flex-1 basis-56">
        <TaskTitle task={task} after={lead && task.dueDate ? <span className="sm:hidden"><InlineDue dueDate={task.dueDate} late={isLate(task)} /></span> : undefined} />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <MetaBadge meta={TASK_STATUS_META} value={task.status} />
          <TaskMeta task={task} slug={slug} showGoal={showGoal} showDue={showDue} />
        </div>
        <TaskLinks links={task.links} className="mt-1.5" />
      </div>
      <TaskActionRow task={task} slug={slug} canWrite={canWrite} goals={goals} />
    </li>
  );
}

/** A late task that already sits in the questions card above: one line pointing to its entry. */
export function TaskPointer({ task, href, children }: { task: TaskView; href: string; children: ReactNode }) {
  return (
    <li data-task={task.id} className="border-b border-rule py-2.5 last:border-b-0">
      <p className="text-sm font-semibold text-ink">{task.title}</p>
      <Link href={href} className="text-xs font-semibold text-wait-ink link">
        {children}
      </Link>
    </li>
  );
}
