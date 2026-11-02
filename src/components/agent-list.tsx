import { Bot } from "lucide-react";

import type { Tone } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import type { Agent } from "@/server/domain/agents";

/** Matches the window the workspace stats use for "active agents". */
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AgentStatus = "active" | "idle" | "revoked";

export const AGENT_STATUS_META: Record<AgentStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "success" },
  idle: { label: "Idle", tone: "neutral" },
  revoked: { label: "Revoked", tone: "danger" },
};

export function agentStatus(agent: Agent, now = Date.now()): AgentStatus {
  if (agent.revokedAt) return "revoked";
  return agent.lastSeenAt && now - agent.lastSeenAt.getTime() < ACTIVE_WINDOW_MS ? "active" : "idle";
}

/** Compact list for the dashboard sidebar. */
export function AgentList({ agents }: { agents: readonly Agent[] }) {
  return (
    <ul className="space-y-2.5">
      {agents.map((agent) => {
        const status = agentStatus(agent);
        return (
          <li key={agent.id} className="flex items-center gap-2.5 text-sm">
            <span className="relative flex size-6 items-center justify-center rounded-full bg-sky-50 text-sky-600">
              <Bot className="size-3.5" aria-hidden />
              <span
                className={cx(
                  "absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-white",
                  status === "active" ? "bg-emerald-500" : "bg-zinc-300",
                )}
                aria-label={status}
              />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{agent.name}</span>
            <span className="text-xs text-zinc-400">{agent.lastSeenAt ? timeAgo(agent.lastSeenAt) : "never connected"}</span>
          </li>
        );
      })}
    </ul>
  );
}
