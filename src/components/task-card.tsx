import { Bot, CalendarClock, Target } from "lucide-react";
import Link from "next/link";

import { completeTaskAction, releaseTaskAction, updateTaskAction } from "@/app/w/[slug]/actions";
import { isOpenTaskStatus, PRIORITY_META, SOURCE_META, type TaskStatus } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { formatDueDate, isPastDue } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { TaskView } from "@/server/domain/tasks";

import { ActionForm } from "./ui/action-form";
import { Badge, MetaBadge } from "./ui/badge";
import { SubmitButton } from "./ui/submit-button";

/** The one-click next step for each status; "done" goes through complete so it is logged as completion. */
const NEXT_STEP: Partial<Record<TaskStatus, { label: string; status: TaskStatus }>> = {
  inbox: { label: "Accept", status: "todo" },
  todo: { label: "Start", status: "in_progress" },
  in_progress: { label: "Done", status: "done" },
  done: { label: "Reopen", status: "todo" },
  dropped: { label: "Restore", status: "todo" },
};

interface TaskCardProps {
  task: TaskView;
  slug: string;
  canWrite: boolean;
  /** Hide the goal link when the card is already shown under its goal. */
  showGoal?: boolean;
}

export function TaskCard({ task, slug, canWrite, showGoal = true }: TaskCardProps) {
  const overdue = isOpenTaskStatus(task.status) && isPastDue(task.dueDate);
  const next = NEXT_STEP[task.status];

  return (
    <article className="group rounded-lg border border-zinc-200 bg-white p-3 shadow-xs">
      <div className="flex items-start gap-2">
        <p className={cx("min-w-0 flex-1 text-sm font-medium text-zinc-900", task.status === "dropped" && "line-through")}>
          {task.title}
        </p>
        {task.priority !== "medium" && <MetaBadge meta={PRIORITY_META} value={task.priority} />}
      </div>
      {task.description && <p className="mt-1 line-clamp-2 text-xs whitespace-pre-line text-zinc-500">{task.description}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        {showGoal && task.goalId && task.goalTitle && (
          <Link href={routes.goal(slug, task.goalId)} className="inline-flex max-w-48 items-center gap-1 hover:text-zinc-900">
            <Target className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{task.goalTitle}</span>
          </Link>
        )}
        {task.dueDate && (
          <span className={cx("inline-flex items-center gap-1", overdue && "font-medium text-red-600")}>
            <CalendarClock className="size-3" aria-hidden />
            {overdue ? "Overdue · " : ""}
            {formatDueDate(task.dueDate)}
          </span>
        )}
        {task.source !== "manual" && <span>{SOURCE_META[task.source].label}</span>}
        {task.claimedByName && (
          <Badge tone="info">
            <Bot aria-hidden />
            {task.claimedByName}
          </Badge>
        )}
      </div>

      {canWrite && next && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-zinc-100 pt-2.5">
          {next.status === "done" ? (
            <ActionForm action={completeTaskAction} workspace={slug} quiet>
              <input type="hidden" name="taskId" value={task.id} />
              <SubmitButton size="sm" variant="primary">
                {next.label}
              </SubmitButton>
            </ActionForm>
          ) : (
            <ActionForm action={updateTaskAction} workspace={slug} quiet>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="status" value={next.status} />
              <SubmitButton size="sm">{next.label}</SubmitButton>
            </ActionForm>
          )}
          {task.claimedByName && (
            <ActionForm action={releaseTaskAction} workspace={slug} quiet>
              <input type="hidden" name="taskId" value={task.id} />
              <SubmitButton size="sm" variant="ghost">
                Release
              </SubmitButton>
            </ActionForm>
          )}
          {isOpenTaskStatus(task.status) && (
            <ActionForm action={updateTaskAction} workspace={slug} quiet>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="status" value="dropped" />
              <SubmitButton size="sm" variant="ghost">
                Drop
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
    </article>
  );
}
