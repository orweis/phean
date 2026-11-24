import { sql } from "drizzle-orm";
import { z } from "zod";

import { CLIENT_FAMILIES, clientFamily, distinctByWindow, REPORT_DAYS, TREND_WINDOWS, trailingWindows, WINDOW_DAYS, type ClientFamily, type DayWindow } from "@/lib/backoffice";
import { addDays, dayOf, isoDate, todayIso } from "@/lib/dates";
import type { AgentAccessLevel } from "@/lib/domain";

import { queryRows } from "../db/raw";
import { activeActors } from "./queries";
import { platformService } from "./service";

export interface ClientBreakdown {
  client: ClientFamily;
  /** Distinct client names seen under this family ("Claude Code", "claude-code 2.1"). */
  names: string[];
  agents: number;
  live: number;
  byLevel: Record<AgentAccessLevel, number>;
  subagents: number;
  workspaces: number;
  activeLastWeek: number;
}

export interface ToolUsage {
  tool: string;
  calls: number;
  errors: number;
  agents: number;
  workspaces: number;
}

export interface AgentsReport {
  windows: DayWindow[];
  clients: ClientBreakdown[];
  activeAgents: number[];
  tools: ToolUsage[];
  totals: { agents: number; live: number; subagents: number; calls: number; errors: number };
}

/**
 * Agents by the client they connect with, their levels and sub-agents, how many were active each
 * week, and which MCP tools they call (with errors), over every workspace. The pipelines agent is left out.
 */
export const getAgentsReport = platformService("view.agents", z.object({}), async (ctx): Promise<AgentsReport> => {
  const now = new Date();
  const today = todayIso(now);
  const windows = trailingWindows(today, TREND_WINDOWS);
  const lastWeekFrom = isoDate(addDays(dayOf(today), -(WINDOW_DAYS - 1)));
  const toolsFrom = isoDate(addDays(dayOf(today), -(REPORT_DAYS - 1)));

  const [agentRows, actors, tools] = await Promise.all([
    queryRows<{ id: string; tenantId: string; authKind: string; clientName: string | null; sharesParentKey: boolean; level: AgentAccessLevel; sub: boolean; live: boolean }>(
      ctx.db,
      sql`select a.id, a.tenant_id as "tenantId", a.auth_kind as "authKind", c.name as "clientName", a.shares_parent_key as "sharesParentKey",
            a.access_level as level, a.parent_agent_id is not null as sub,
            (a.revoked_at is null and (a.access_expires_at is null or a.access_expires_at > now())) as live
          from agents a left join oauth_client c on c.client_id = a.oauth_client_id where a.auth_kind <> 'system'`,
    ),
    activeActors(ctx.db, windows[0]!.from, now),
    queryRows<ToolUsage>(
      ctx.db,
      sql`select tool, sum(calls)::int as calls, sum(errors)::int as errors, count(distinct agent_id)::int as agents, count(distinct tenant_id)::int as workspaces
          from tool_calls_daily where day >= ${toolsFrom}::date group by 1 order by 2 desc, 1`,
    ),
  ]);

  const agentActors = actors.filter((row) => row.actorType === "agent");
  const activeIds = new Set(agentActors.filter((row) => row.day >= lastWeekFrom).map((row) => row.actorId));
  const families = new Map<ClientFamily, { names: Set<string>; rows: typeof agentRows }>();
  for (const row of agentRows) {
    const family = clientFamily(row);
    const entry = families.get(family) ?? { names: new Set(), rows: [] };
    if (row.clientName) entry.names.add(row.clientName);
    entry.rows.push(row);
    families.set(family, entry);
  }
  const clients = [...families]
    .map(([client, { names, rows }]): ClientBreakdown => {
      const live = rows.filter((row) => row.live);
      return {
        client,
        names: [...names].sort(),
        agents: rows.length,
        live: live.length,
        byLevel: {
          read: live.filter((row) => row.level === "read").length,
          write: live.filter((row) => row.level === "write").length,
          admin: live.filter((row) => row.level === "admin").length,
        },
        subagents: live.filter((row) => row.sub).length,
        workspaces: new Set(live.map((row) => row.tenantId)).size,
        activeLastWeek: rows.filter((row) => activeIds.has(row.id)).length,
      };
    })
    .sort((a, b) => b.live - a.live || CLIENT_FAMILIES.indexOf(a.client) - CLIENT_FAMILIES.indexOf(b.client));
  const toolRows = tools.map((row) => ({ tool: row.tool, calls: Number(row.calls), errors: Number(row.errors), agents: Number(row.agents), workspaces: Number(row.workspaces) }));

  return {
    windows,
    clients,
    activeAgents: distinctByWindow(agentActors.map((row) => ({ day: row.day, key: row.actorId })), windows),
    tools: toolRows,
    totals: {
      agents: agentRows.length,
      live: agentRows.filter((row) => row.live).length,
      subagents: agentRows.filter((row) => row.live && row.sub).length,
      calls: toolRows.reduce((sum, row) => sum + row.calls, 0),
      errors: toolRows.reduce((sum, row) => sum + row.errors, 0),
    },
  };
});
