import { Bot } from "lucide-react";
import Link from "next/link";

import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { Goal } from "@/server/domain/goals";

import { GoalStatusActions } from "./goal-status-actions";

/** Goals agents proposed, waiting for a human decision. */
export function PendingApprovals({ goals, slug, canDecide }: { goals: readonly Goal[]; slug: string; canDecide: boolean }) {
  return (
    <ul className="divide-y divide-amber-100">
      {goals.map((goal) => (
        <li key={goal.id} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <Link href={routes.goal(slug, goal.id)} className="block truncate text-sm font-medium text-zinc-900 hover:underline">
              {goal.title}
            </Link>
            <p className="flex items-center gap-1 text-xs text-zinc-500">
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
