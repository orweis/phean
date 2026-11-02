import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { WorkspaceStats } from "@/server/domain/overview";

import { FlowBar, FlowLegend } from "./charts/flow-bar";
import { Stat, StatStrip } from "./ui/stat";

/** Open work by station, then the figures that say whether the line is on time. */
export function TodayStrip({ stats, slug }: { stats: WorkspaceStats; slug: string }) {
  return (
    <section aria-label="Today on the line">
      <StatStrip className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))]">
        <div className="col-span-2 min-w-0 bg-panel px-4 py-3 sm:col-span-4 lg:col-span-1">
          <p className="flex items-baseline justify-between gap-3 text-xs text-muted">
            Open work by status
            <span className="text-sm font-bold text-ink">{pluralize(stats.openTasks, "task")}</span>
          </p>
          <FlowBar counts={stats.tasksByStatus} stations={OPEN_TASK_STATUSES} size="lg" label="Open work by status" className="mt-2" />
          <FlowLegend counts={stats.tasksByStatus} stations={OPEN_TASK_STATUSES} className="mt-2" />
        </div>
        <Stat label="Late" value={stats.overdue} tone={stats.overdue ? "danger" : undefined} hint="past due, still open" />
        <Stat label="Due this week" value={stats.dueThisWeek} hint="next 7 days" />
        <Stat label="Done, last 7 days" value={stats.doneLast7Days} tone={stats.doneLast7Days ? "success" : undefined} href={routes.board(slug)} />
        <Stat label="Agents active" value={stats.activeAgents} hint={`of ${stats.agents} connected`} href={routes.agents(slug)} />
      </StatStrip>
    </section>
  );
}
