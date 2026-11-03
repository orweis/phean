import { Target } from "lucide-react";
import Link from "next/link";

import { GOAL_STATUS_META, type GoalStatus } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { percent } from "@/lib/format";
import { treeGuides } from "@/lib/goal-tree";
import { routes } from "@/lib/routes";
import type { GoalWithProgress } from "@/server/domain/goals";

import { FlowBar } from "./charts/flow-bar";
import { MetaBadge } from "./ui/badge";
import { EmptyState } from "./ui/stat";

/** Each goal is a station on the map: filled when achieved, ringed while active, dashed while proposed. */
const STATION_MARK: Record<GoalStatus, string> = {
  proposed: "border-2 border-dashed border-wait bg-panel",
  active: "border-2 border-accent bg-panel",
  achieved: "border-2 border-arrive bg-arrive",
  abandoned: "border-2 border-faint bg-fill",
};

interface GoalTreeProps {
  goals: readonly GoalWithProgress[];
  slug: string;
  baseDepth?: number;
  empty?: { title: string; hint: string };
}

const DEFAULT_EMPTY = { title: "No goals yet", hint: "Agents propose goals as they triage the inbox. You can also start one with Add manually." };

/**
 * The goal map: goals in depth-first order joined by rails, each with its tasks by station
 * rolled up from every sub-goal.
 */
export function GoalTree({ goals, slug, baseDepth = 0, empty = DEFAULT_EMPTY }: GoalTreeProps) {
  if (goals.length === 0) {
    return (
      <EmptyState icon={<Target />} title={empty.title}>
        {empty.hint}
      </EmptyState>
    );
  }
  const rows = goals.map((goal) => ({ goal, depth: goal.depth - baseDepth }));
  const guides = treeGuides(rows);

  return (
    <ul>
      {rows.map(({ goal, depth }, index) => {
        const guide = guides[index]!;
        const inactive = goal.status === "achieved" || goal.status === "abandoned";
        return (
          <li key={goal.id} className="flex items-stretch gap-3">
            <div aria-hidden className="flex shrink-0">
              {guide.rails.map((continues, level) => (
                <span key={level} className="relative w-5">
                  {continues && <span className="absolute inset-y-0 left-2 w-0.5 bg-faint" />}
                </span>
              ))}
              {depth > 0 && (
                <span className="relative w-5">
                  <span className={cx("absolute top-0 left-2 w-0.5 bg-faint", guide.last ? "h-1/2" : "h-full")} />
                  <span className="absolute top-1/2 left-2 h-0.5 w-3 bg-faint" />
                </span>
              )}
              <span className="relative w-5">
                {rows[index + 1] && rows[index + 1]!.depth > depth && <span className="absolute top-1/2 bottom-0 left-2 w-0.5 bg-faint" />}
                <span className={cx("absolute top-1/2 left-0.5 size-3.5 -translate-y-1/2 rounded-full", STATION_MARK[goal.status])} />
              </span>
            </div>

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule py-2.5">
              <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
                <Link
                  href={routes.goal(slug, goal.id)}
                  className={cx("truncate text-sm font-semibold link", inactive ? "text-muted" : "text-ink")}
                >
                  {goal.title}
                </Link>
                {goal.status !== "active" && <MetaBadge meta={GOAL_STATUS_META} value={goal.status} />}
              </div>
              <div className="flex w-full items-center gap-3 sm:w-56">
                <FlowBar counts={goal.rollup} label={`${goal.title} tasks by status`} className="flex-1" />
                <span className="w-20 shrink-0 text-right text-xs text-muted">
                  <span className="font-semibold text-ink">{percent(goal.progress)}</span> {goal.rollup.done}/{goal.rollup.total}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
