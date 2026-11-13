import { Archive, ArrowRight, Bot, CalendarClock, Check, CircleX, CornerDownRight, Ellipsis, Handshake, ListChecks, Trash2, Unlock, User, UserCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  archiveTaskAction,
  cancelHandOffAction,
  completeTaskAction,
  releaseTaskAction,
  takeTaskAction,
  unarchiveTaskAction,
  updateTaskAction,
} from "@/app/w/[slug]/actions";
import { webUrl } from "@/lib/agent-sessions";
import { cx } from "@/lib/cx";
import { DELEGATION_META, isLate, isOpenTaskStatus, PRIORITY_META, SOURCE_META, TASK_STATUS_META, type TaskStatus } from "@/lib/domain";
import { formatDueDate, relativeDue, timeAgo, truncate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { stageLabel, stageOf, visibleStages, type Workflow } from "@/lib/workflow";
import { requireWorkspace } from "@/server/auth/session";
import type { TaskView } from "@/server/domain/tasks";
import { workspaceWorkflow } from "@/server/web";

import { OutsideLink, QuestionNote, ResumePopover, TaskLinks, WaitingBadge } from "./agent-sessions";
import { DocumentChips } from "./documents/document-chips";
import { EditTaskPopover } from "./edit-task-form";
import { GoalLink } from "./goal-link";
import type { GoalOption } from "./goal-options";
import { ActionButton } from "./ui/action-button";
import { Badge, MetaBadge } from "./ui/badge";
import { Popover } from "./ui/popover";
import type { UndoSpec } from "./ui/status-region";

/** The one-click next step for each status; "done" goes through complete so it is logged as completion. */
const NEXT_STEP: Partial<Record<TaskStatus, { label: string; status: TaskStatus; notice: (title: string) => string }>> = {
  inbox: { label: "Accept", status: "todo", notice: (title) => `Moved ${title} to To do` },
  backlog: { label: "Plan", status: "todo", notice: (title) => `Planned ${title}` },
  todo: { label: "Start", status: "in_progress", notice: (title) => `Started ${title}` },
  in_progress: { label: "Done", status: "done", notice: (title) => `Done: ${title}` },
  done: { label: "Reopen", status: "todo", notice: (title) => `Reopened ${title}` },
  dropped: { label: "Restore", status: "todo", notice: (title) => `Restored ${title}` },
};

/** Fits two lines in the narrowest lane, so no clamped text sits hidden under the meta row. */
const CARD_EXCERPT = 80;

/** A task's title as the status region quotes it. */
const quoted = (task: TaskView) => `“${truncate(task.title, 60)}”`;

/** The move that puts a task back where it stood: its own stage, or its old status when dropped. */
export function moveBack(task: Pick<TaskView, "id" | "status" | "stage">, workflow: Workflow, restored: string): UndoSpec {
  const stage = stageOf(workflow, task);
  return { action: updateTaskAction, fields: { taskId: task.id, ...(stage ? { stage: stage.key } : { status: task.status }) }, done: restored };
}

/** The next step, as the one prominent action of a task; the rest wait in its ⋯ menu. */
async function NextStep({ task, slug }: { task: TaskView; slug: string }) {
  const next = NEXT_STEP[task.status];
  if (!next) return null;
  const taskId = task.id;
  const workflow = await workspaceWorkflow(slug);
  const back = moveBack(task, workflow, `${quoted(task)} is back in ${stageLabel(workflow, task)}.`);
  // Starting a task makes the person who starts it its operator.
  if (task.status === "todo") {
    return (
      <ActionButton action={takeTaskAction} workspace={slug} fields={{ taskId }} notice={next.notice(quoted(task))} undo={back} size="sm" variant="tinted">
        {next.label}
      </ActionButton>
    );
  }
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
 * Every other move, behind one ghost ⋯ that is always visible: straight to any stage (inbox to done
 * in one step, which a narrow lane or a phone has no room to show as buttons), then Release and
 * Drop, or Archive for finished work. Each is undone from the status region rather than confirmed,
 * since all are reversible.
 */
async function MoreActions({ task, slug }: { task: TaskView; slug: string }) {
  const taskId = task.id;
  const { ctx } = await requireWorkspace(slug);
  const mine = task.operatorUserId === ctx.actor.id;
  const canTake = isOpenTaskStatus(task.status) && !mine;
  const canDrop = isOpenTaskStatus(task.status);
  const canArchive = !canDrop && !task.archivedAt;
  const workflow = await workspaceWorkflow(slug);
  const here = stageOf(workflow, task);
  const back = moveBack(task, workflow, `${quoted(task)} is back in ${stageLabel(workflow, task)}.`);
  const targets = visibleStages(workflow).filter((stage) => stage.key !== here?.key);
  return (
    <Popover menu variant="ghost" label={<Ellipsis aria-hidden />} triggerLabel={`More actions for ${task.title}`} triggerClassName="px-2">
      <p className="px-2.5 pt-1 pb-1 text-xs text-muted">Move to</p>
      <div role="group" aria-label="Move to">
        {targets.map((stage) => (
          <ActionButton
            key={stage.key}
            action={updateTaskAction}
            workspace={slug}
            fields={{ taskId, stage: stage.key }}
            notice={`Moved ${quoted(task)} to ${stage.label}`}
            undo={back}
            closeOnSuccess
            size="menu"
            variant="ghost"
          >
            <ArrowRight aria-hidden />
            {stage.label}
          </ActionButton>
        ))}
      </div>
      {(canTake || task.operatorName || canDrop || canArchive) && <div className="my-1 border-t border-rule" />}
      {canTake && (
        <ActionButton action={takeTaskAction} workspace={slug} fields={{ taskId }} notice={`You're working on ${quoted(task)}`} closeOnSuccess size="menu" variant="ghost">
          <UserCheck aria-hidden />
          {task.operatorName ? `Take over from ${task.operatorName}` : "Take it"}
        </ActionButton>
      )}
      {task.delegation === "handing_off" && (
        <ActionButton action={cancelHandOffAction} workspace={slug} fields={{ taskId }} notice={`Called off the handoff of ${quoted(task)}`} closeOnSuccess size="menu" variant="ghost">
          <CircleX aria-hidden />
          Call off the handoff
        </ActionButton>
      )}
      {task.operatorName && (
        <ActionButton
          action={releaseTaskAction}
          workspace={slug}
          fields={{ taskId }}
          notice={mine ? `You stopped working on ${quoted(task)}` : `Released ${quoted(task)} from ${task.operatorName}`}
          closeOnSuccess
          size="menu"
          variant="ghost"
        >
          <Unlock aria-hidden />
          {mine ? "Stop working on it" : `Release from ${task.operatorName}`}
        </ActionButton>
      )}
      {canDrop && (
        <ActionButton
          action={updateTaskAction}
          workspace={slug}
          fields={{ taskId, status: "dropped" }}
          notice={`Dropped ${quoted(task)}`}
          undo={back}
          exits
          closeOnSuccess
          size="menu"
          variant="ghost"
        >
          <Trash2 aria-hidden />
          Drop
        </ActionButton>
      )}
      {canArchive && (
        <ActionButton
          action={archiveTaskAction}
          workspace={slug}
          fields={{ taskId }}
          notice={`Archived ${quoted(task)}`}
          undo={{ action: unarchiveTaskAction, fields: { taskId }, done: `${quoted(task)} is back on the board.` }}
          exits
          closeOnSuccess
          size="menu"
          variant="ghost"
        >
          <Archive aria-hidden />
          Archive
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

/** Where a task stands, named as the workspace names its stage ("In review"), in its kind's tone. */
export async function StageBadge({ task, slug }: { task: TaskView; slug: string }) {
  const workflow = await workspaceWorkflow(slug);
  return <Badge tone={TASK_STATUS_META[task.status].tone}>{stageLabel(workflow, task)}</Badge>;
}

/** "Nov 2 · 2 days late", the due date as compact rows show it, inline with the title. */
export function InlineDue({ dueDate, late }: { dueDate: string; late: boolean }) {
  return (
    <span className={cx("text-xs whitespace-nowrap", late ? "font-semibold text-late-ink" : "text-muted")}>
      {formatDueDate(dueDate)} · {relativeDue(dueDate)}
    </span>
  );
}

/** Goal, due date, source and claimant: the facts every task listing shows. */
export function TaskMeta({ task, slug, showGoal, showDue = true }: { task: TaskView; slug: string; showGoal: boolean; showDue?: boolean }) {
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
      {task.operatorName && (
        <span className="inline-flex items-center gap-1">
          {task.operatorType === "user" ? <User className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
          Operator: {task.operatorName}
        </span>
      )}
      <DelegationBadge task={task} />
    </div>
  );
}

/** "Handing off to Closer", "Picking up", "Returned": a handover under way, in words and in its tone. */
export function DelegationBadge({ task }: { task: Pick<TaskView, "delegation" | "delegateToName"> }) {
  if (!task.delegation) return null;
  const { label, tone } = DELEGATION_META[task.delegation];
  return (
    <Badge tone={tone}>
      <Handshake aria-hidden />
      {task.delegation === "handing_off" ? `${label} to ${task.delegateToName ?? "anyone"}` : label}
    </Badge>
  );
}

/** The last operator's note for whoever takes the task next, while a handover is under way. */
export function HandoverNote({ task }: { task: Pick<TaskView, "delegation" | "delegationNote" | "delegatedAt"> }) {
  if (!task.delegation || !task.delegationNote) return null;
  return (
    <figure className="rounded-md border border-rule bg-fill/60 px-3 py-2 text-sm">
      <figcaption className="text-xs font-semibold text-ink-2">
        {task.delegation === "returned" ? "Note left when it was released" : "Handoff note"}
        <span className="font-normal text-muted"> · {timeAgo(task.delegatedAt)}</span>
      </figcaption>
      <blockquote className="mt-1 whitespace-pre-wrap text-ink">{task.delegationNote}</blockquote>
    </figure>
  );
}

/** The title, with its priority right after the words, where the eye already is. */
/**
 * The title, which opens the task in a peek over the page (its own page on a refresh or a shared
 * link), with its priority right after the words, where the eye already is.
 */
function TaskTitle({ task, slug, after }: { task: TaskView; slug: string; after?: ReactNode }) {
  return (
    <p className={cx("text-sm font-semibold text-ink", task.status === "dropped" && "text-muted line-through")}>
      <Link href={routes.task(slug, task.id)} scroll={false} data-task-link className="rounded-xs hover:underline hover:underline-offset-2">
        {task.title}
      </Link>
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
export function TaskActionRow({ task, slug, canWrite, goals, className }: TaskViewProps & { className?: string }) {
  if (!canWrite && task.agentSessions.length === 0) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {canWrite && <NextStep task={task} slug={slug} />}
      {canWrite && <EditTaskPopover task={task} slug={slug} goals={goals ?? []} compact={task.agentSessions.length > 0} />}
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
    <article
      data-task={task.id}
      className={cx(
        "@container rounded-md border bg-panel p-3 has-[a[data-task-link]:focus-visible]:outline-2 has-[a[data-task-link]:focus-visible]:outline-offset-2 has-[a[data-task-link]:focus-visible]:outline-focus",
        // Late work stays loud; a task on its way to another operator gets a dashed edge, in transit.
        isLate(task) ? "border-late/45" : task.delegation === "handing_off" ? "border-dashed border-line-inbox" : "border-rule",
        LEAVING,
      )}
    >
      <TaskTitle task={task} slug={slug} />
      {task.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{truncate(task.description, CARD_EXCERPT)}</p>}
      <div className="mt-2">
        <TaskMeta task={task} slug={slug} showGoal={showGoal} />
      </div>
      <TaskLinks links={task.links} className="mt-2" />
      <DocumentChips documents={task.documents} slug={slug} className="mt-2" />
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
        <TaskTitle task={task} slug={slug} after={task.dueDate && <InlineDue dueDate={task.dueDate} late={isLate(task)} />} />
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
        <TaskTitle task={task} slug={slug} after={lead && task.dueDate ? <span className="sm:hidden"><InlineDue dueDate={task.dueDate} late={isLate(task)} /></span> : undefined} />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <StageBadge task={task} slug={slug} />
          <TaskMeta task={task} slug={slug} showGoal={showGoal} showDue={showDue} />
        </div>
        <TaskLinks links={task.links} className="mt-1.5" />
        <DocumentChips documents={task.documents} slug={slug} className="mt-1.5" />
      </div>
      <TaskActionRow task={task} slug={slug} canWrite={canWrite} goals={goals} />
    </li>
  );
}

/** A task as a quiet line for a peek (the Goals page): its title opens the task, then its stage and facts, no actions. */
export function TaskLine({ task, slug }: { task: TaskView; slug: string }) {
  return (
    <li data-task={task.id} className="border-b border-rule py-2.5 last:border-b-0">
      <TaskTitle task={task} slug={slug} />
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <StageBadge task={task} slug={slug} />
        <TaskMeta task={task} slug={slug} showGoal={false} />
      </div>
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
