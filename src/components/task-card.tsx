import { Bot, CalendarClock } from "lucide-react";
import type { ReactNode } from "react";

import { completeTaskAction, releaseTaskAction, updateTaskAction } from "@/app/w/[slug]/actions";
import { cx } from "@/lib/cx";
import { isLate, isOpenTaskStatus, PRIORITY_META, SOURCE_META, TASK_STATUS_META, type TaskStatus } from "@/lib/domain";
import { formatDueDate, truncate } from "@/lib/format";
import type { TaskView } from "@/server/domain/tasks";

import { GoalLink } from "./goal-link";
import { ActionButton } from "./ui/action-button";
import { Badge, MetaBadge } from "./ui/badge";

/** The one-click next step for each status; "done" goes through complete so it is logged as completion. */
const NEXT_STEP: Partial<Record<TaskStatus, { label: string; status: TaskStatus }>> = {
  inbox: { label: "Accept", status: "todo" },
  todo: { label: "Start", status: "in_progress" },
  in_progress: { label: "Done", status: "done" },
  done: { label: "Reopen", status: "todo" },
  dropped: { label: "Restore", status: "todo" },
};

/** Fits two lines in the narrowest lane, so no clamped text sits hidden under the meta row. */
const CARD_EXCERPT = 80;

/** Next step, release and drop, as compact buttons. */
function TaskActions({ task, slug }: { task: TaskView; slug: string }) {
  const next = NEXT_STEP[task.status];
  const taskId = task.id;
  return (
    <div className="flex flex-wrap gap-1.5">
      {next &&
        (next.status === "done" ? (
          <ActionButton action={completeTaskAction} workspace={slug} fields={{ taskId }} size="sm" variant="primary">
            {next.label}
          </ActionButton>
        ) : (
          <ActionButton action={updateTaskAction} workspace={slug} fields={{ taskId, status: next.status }} size="sm">
            {next.label}
          </ActionButton>
        ))}
      {task.claimedByName && (
        <ActionButton action={releaseTaskAction} workspace={slug} fields={{ taskId }} size="sm" variant="ghost">
          Release
        </ActionButton>
      )}
      {isOpenTaskStatus(task.status) && (
        <ActionButton action={updateTaskAction} workspace={slug} fields={{ taskId, status: "dropped" }} size="sm" variant="ghost">
          Drop
        </ActionButton>
      )}
    </div>
  );
}

/** Goal, due date, source and claimant: the facts every task listing shows. */
function TaskMeta({ task, slug, showGoal, showDue = true }: { task: TaskView; slug: string; showGoal: boolean; showDue?: boolean }) {
  const late = isLate(task);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {showGoal && task.goalId && task.goalTitle && <GoalLink slug={slug} goalId={task.goalId} title={task.goalTitle} />}
      {showDue && task.dueDate && (
        <span className={cx("inline-flex items-center gap-1", late && "font-semibold text-late-ink")}>
          <CalendarClock className="size-3" aria-hidden />
          {late ? `Late, due ${formatDueDate(task.dueDate)}` : `Due ${formatDueDate(task.dueDate)}`}
        </span>
      )}
      {task.source !== "manual" && <span>From {SOURCE_META[task.source].label.toLowerCase()}</span>}
      {task.claimedByName && (
        <Badge tone="info">
          <Bot aria-hidden />
          {task.claimedByName}
        </Badge>
      )}
    </div>
  );
}

function TaskTitle({ task }: { task: TaskView }) {
  return (
    <div className="flex items-start gap-2">
      <p className={cx("min-w-0 flex-1 text-sm font-semibold text-ink", task.status === "dropped" && "text-muted line-through")}>{task.title}</p>
      {task.priority !== "medium" && <MetaBadge meta={PRIORITY_META} value={task.priority} />}
    </div>
  );
}

interface TaskViewProps {
  task: TaskView;
  slug: string;
  canWrite: boolean;
  /** Hide the goal link when the task is already shown under its goal. */
  showGoal?: boolean;
}

/** A task on a board lane. */
export function TaskCard({ task, slug, canWrite, showGoal = true }: TaskViewProps) {
  return (
    <article data-task={task.id} className={cx("rounded-md border bg-panel p-3", isLate(task) ? "border-late/45" : "border-rule")}>
      <TaskTitle task={task} />
      {task.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{truncate(task.description, CARD_EXCERPT)}</p>}
      <div className="mt-2">
        <TaskMeta task={task} slug={slug} showGoal={showGoal} />
      </div>
      {canWrite && NEXT_STEP[task.status] && (
        <div className="mt-2.5 border-t border-rule pt-2.5">
          <TaskActions task={task} slug={slug} />
        </div>
      )}
    </article>
  );
}

/** A task as one line of a list, with an optional leading column such as its due date. */
export function TaskRow({ task, slug, canWrite, showGoal = true, lead, showDue = !lead }: TaskViewProps & { lead?: ReactNode; showDue?: boolean }) {
  return (
    <li data-task={task.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-rule py-3 last:border-b-0">
      {lead && <div className="w-20 shrink-0">{lead}</div>}
      <div className="min-w-0 flex-1 basis-56">
        <TaskTitle task={task} />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <MetaBadge meta={TASK_STATUS_META} value={task.status} />
          <TaskMeta task={task} slug={slug} showGoal={showGoal} showDue={showDue} />
        </div>
      </div>
      {canWrite && <TaskActions task={task} slug={slug} />}
    </li>
  );
}
