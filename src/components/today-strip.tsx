import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { WorkspaceStats } from "@/server/domain/overview";

import { FlowStat } from "./charts/flow-bar";
import { Stat, StatStrip } from "./ui/stat";

/** Open work by station, then the figures that say whether the line is on time. */
export function TodayStrip({ stats, slug }: { stats: WorkspaceStats; slug: string }) {
  return (
    <section aria-label="Today on the line">
      <StatStrip className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))]">
        <FlowStat label="Open work by status" figure={pluralize(stats.openTasks, "task")} counts={stats.tasksByStatus} stations={OPEN_TASK_STATUSES} />
        <Stat label="Late" value={stats.overdue} tone={stats.overdue ? "danger" : undefined} hint="past due, still open" />
        <Stat label="Due this week" value={stats.dueThisWeek} hint="next 7 days" />
        <Stat label="Done, last 7 days" value={stats.doneLast7Days} tone={stats.doneLast7Days ? "success" : undefined} href={routes.board(slug)} />
        <Stat label="Agents active" value={stats.activeAgents} hint={`of ${stats.agents} connected`} href={routes.agents(slug)} />
      </StatStrip>
    </section>
  );
}
