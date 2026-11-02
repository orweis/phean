import { Target } from "lucide-react";
import Link from "next/link";

import { GOAL_STATUS_META } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { percent } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { GoalWithProgress } from "@/server/domain/goals";

import { MetaBadge } from "./ui/badge";
import { EmptyState, ProgressBar } from "./ui/stat";

/** Goals in depth-first order, indented by depth, with progress rolled up from sub-goals. */
export function GoalTree({ goals, slug, baseDepth = 0 }: { goals: readonly GoalWithProgress[]; slug: string; baseDepth?: number }) {
  if (goals.length === 0) {
    return (
      <EmptyState icon={<Target />} title="No goals yet">
        Create one, or let an agent propose goals while it triages the inbox.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-zinc-100">
      {goals.map((goal) => {
        const inactive = goal.status === "achieved" || goal.status === "abandoned";
        return (
          <li key={goal.id} className="flex items-center gap-3 py-2.5" style={{ paddingLeft: `${(goal.depth - baseDepth) * 1.25}rem` }}>
            <span
              aria-hidden
              className={cx("size-1.5 shrink-0 rounded-full", goal.depth === baseDepth ? "bg-violet-500" : "bg-zinc-300")}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={routes.goal(slug, goal.id)}
                  className={cx("truncate text-sm font-medium hover:underline", inactive ? "text-zinc-400" : "text-zinc-900")}
                >
                  {goal.title}
                </Link>
                {goal.status !== "active" && <MetaBadge meta={GOAL_STATUS_META} value={goal.status} />}
              </div>
            </div>
            <div className="hidden w-36 shrink-0 items-center gap-2 sm:flex">
              <ProgressBar value={goal.progress} className="flex-1" />
              <span className="w-9 text-right text-xs text-zinc-500 tabular-nums">{percent(goal.progress)}</span>
            </div>
            <span className="w-16 shrink-0 text-right text-xs text-zinc-500 tabular-nums">
              {goal.rollup.done}/{goal.rollup.total}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
