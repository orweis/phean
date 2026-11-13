import { ArrowRight, Bot, User } from "lucide-react";
import Link from "next/link";

import { takeTaskAction } from "@/app/w/[slug]/actions";
import { timeAgo, truncate } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { TaskView } from "@/server/domain/tasks";

import { DelegationBadge } from "./task-card";
import { ActionButton } from "./ui/action-button";

/** Whether a task is being handed to the viewer: by name, or to anyone (the same rule as `handedTo`). */
export function isForViewer(task: Pick<TaskView, "delegation" | "delegateToAgentId" | "delegateToUserId" | "operatorUserId">, viewerId: string): boolean {
  if (task.operatorUserId === viewerId) return false;
  return task.delegation === "handing_off" && (task.delegateToUserId === viewerId || (!task.delegateToAgentId && !task.delegateToUserId));
}

/**
 * Work passing between operators, as the overview lists it: each task's handover in words (from
 * whom, to whom, for how long), the note's first lines, and Take it where the handover waits on you.
 */
export function HandoffList({ tasks, slug, viewerId, canWrite }: { tasks: readonly TaskView[]; slug: string; viewerId: string; canWrite: boolean }) {
  return (
    <ul aria-label="Handoffs">
      {tasks.map((task) => {
        const forYou = isForViewer(task, viewerId);
        // A returned task waits for whoever takes it next, so anyone may take it from here.
        const canTake = forYou || task.delegation === "returned";
        const OperatorIcon = task.operatorType === "user" ? User : Bot;
        return (
          <li key={task.id} data-task={task.id} data-handoff={task.delegation ?? undefined} className="border-b border-rule py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <DelegationBadge task={task} />
              {forYou && <span className="text-xs font-semibold text-ink">For you</span>}
            </div>
            <p className="mt-1.5 text-sm font-semibold text-ink">
              <Link href={routes.task(slug, task.id)} scroll={false} className="hover:underline hover:underline-offset-2">
                {task.title}
              </Link>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
              {task.operatorName ? (
                <span className="inline-flex items-center gap-1">
                  <OperatorIcon className="size-3" aria-hidden />
                  {task.delegation === "picking_up" ? `${task.operatorName} is picking it up` : task.operatorName}
                </span>
              ) : (
                <span>No one on it</span>
              )}
              {task.delegation === "handing_off" && (
                <>
                  <ArrowRight className="size-3" aria-label="to" />
                  <span>{task.delegateToName ?? "anyone"}</span>
                </>
              )}
              <span aria-hidden>·</span>
              <span>{timeAgo(task.delegatedAt)}</span>
            </p>
            {task.delegationNote && <p className="mt-1 text-xs text-ink-2">“{truncate(task.delegationNote, 140)}”</p>}
            {canWrite && canTake && (
              <ActionButton
                action={takeTaskAction}
                workspace={slug}
                fields={{ taskId: task.id }}
                notice={`You're working on “${truncate(task.title, 60)}”`}
                size="sm"
                variant="tinted"
                className="mt-2"
              >
                Take it
              </ActionButton>
            )}
          </li>
        );
      })}
    </ul>
  );
}
