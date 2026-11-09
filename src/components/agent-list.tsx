import { Bot } from "lucide-react";

import { cx } from "@/lib/cx";
import { AGENT_STATUS_META, agentStatus } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import type { AgentLoad } from "@/server/domain/overview";

import { EmptyState } from "./ui/stat";

function LoadBar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <span className="h-1.5 rounded-full bg-fill">
      <span className={cx("block h-full rounded-xs", className)} style={{ width: `${(value / max) * 100}%` }} />
    </span>
  );
}

/** What each agent holds now and has finished this week, on one shared scale. */
export function AgentWorkload({ loads, empty }: { loads: readonly AgentLoad[]; empty?: string }) {
  if (loads.length === 0) {
    return (
      <EmptyState icon={<Bot />} title="No agents connected">
        {empty ?? "Add Phean to your MCP client from the Agents page."}
      </EmptyState>
    );
  }
  const max = Math.max(1, ...loads.flatMap((load) => [load.claimed, load.completedLast7Days]));
  return (
    <ul>
      {loads.map(({ agent, claimed, completedLast7Days }) => {
        const status = agentStatus({ ...agent, accessExpiresAt: agent.accessEndsAt });
        return (
          <li key={agent.id} className="border-b border-rule py-3 first:pt-0 last:border-b-0 last:pb-0">
            <div className="flex items-center gap-2 text-sm">
              <span
                aria-label={AGENT_STATUS_META[status].label}
                role="img"
                className={cx("size-2 shrink-0 rounded-full", status === "active" ? "bg-arrive" : "bg-faint")}
              />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{agent.name}</span>
              <span className="shrink-0 text-xs text-muted">{agent.lastSeenAt ? timeAgo(agent.lastSeenAt) : "never connected"}</span>
            </div>
            <div className="mt-2 grid grid-cols-[6rem_minmax(0,1fr)_1.5rem] items-center gap-x-2 gap-y-1.5 text-xs text-muted">
              <span>Holding</span>
              <LoadBar value={claimed} max={max} className="bg-station-progress" />
              <span className="text-right font-semibold text-ink">{claimed}</span>
              <span>Done, 7 days</span>
              <LoadBar value={completedLast7Days} max={max} className="bg-station-done" />
              <span className="text-right font-semibold text-ink">{completedLast7Days}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
