import { Bot } from "lucide-react";
import Link from "next/link";

import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { Goal } from "@/server/domain/goals";

import { GoalStatusActions } from "./goal-status-actions";

/** Goals agents proposed, waiting for a human decision. */
export function PendingApprovals({ goals, slug, canDecide }: { goals: readonly Goal[]; slug: string; canDecide: boolean }) {
  return (
    <ul>
      {goals.map((goal) => (
        <li key={goal.id} data-goal={goal.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule py-3 last:border-b-0">
          <div className="min-w-0 flex-1 basis-56">
            <Link href={routes.goal(slug, goal.id)} className="block truncate text-sm font-semibold text-ink hover:underline">
              {goal.title}
            </Link>
            <p className="flex items-center gap-1 text-xs text-muted">
              {goal.createdByType === "agent" && <Bot className="size-3" aria-hidden />}
              Proposed by {goal.createdByName} {timeAgo(goal.createdAt)}
            </p>
          </div>
          {canDecide && <GoalStatusActions goalId={goal.id} status="proposed" slug={slug} size="sm" />}
        </li>
      ))}
    </ul>
  );
}
