import { Bot, Wrench } from "lucide-react";
import type { Metadata } from "next";

import { Figure, TableScroll, TwoFactorGate } from "@/components/backoffice/parts";
import { TrendCard } from "@/components/backoffice/trend-card";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Stat, StatStrip } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { REPORT_DAYS } from "@/lib/backoffice";
import { cx } from "@/lib/cx";
import { percent } from "@/lib/format";
import { getAgentsReport } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";

export const metadata: Metadata = { title: "Agents" };

function Head({ labels }: { labels: string[] }) {
  return (
    <thead>
      <tr className="border-b border-rule">
        {labels.map((label, index) => (
          <th key={label} scope="col" className={cx(TH, index === 0 ? cx("pl-5 text-left", PINNED_CELL) : "text-right", index === labels.length - 1 && "pr-5")}>
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

const NUM = "px-3 py-2.5 text-right";

export default async function AdminAgentsPage() {
  const access = await requireBackoffice();
  if (access.refusal) return <TwoFactorGate />;
  const report = await getAgentsReport(access.ctx, {});
  const { totals } = report;

  return (
    <>
      <PageHeader
        title="Agents"
        description="Agents across every workspace, by the client they connect with (from their OAuth client's name; fixed keys and shared keys have none), their levels and sub-agents, and the MCP tools they call."
      />
      <StatStrip className="mb-6 grid-cols-2 sm:grid-cols-4">
        <Stat label="Live agents" value={totals.live.toLocaleString("en")} hint={`of ${totals.agents} ever connected`} />
        <Stat label="Live sub-agents" value={totals.subagents.toLocaleString("en")} />
        <Stat label={`Tool calls, ${REPORT_DAYS} days`} value={totals.calls.toLocaleString("en")} />
        <Stat label="Errors" value={totals.calls ? percent(totals.errors / totals.calls) : "None"} hint={`${totals.errors} calls`} tone={totals.errors ? "warning" : undefined} />
      </StatStrip>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="By client" description="Live agents by level, sub-agents, the workspaces they are in, and how many acted in the last 7 days (an event or a tool call)." />
          {report.clients.length === 0 ? (
            <EmptyState icon={<Bot />} title="No agents yet" />
          ) : (
            <TableScroll label="Agents by client">
              <table className="w-full text-sm">
                <caption className="sr-only">Agents by client</caption>
                <Head labels={["Client", "Live", "Admin", "Write", "Read", "Sub-agents", "Workspaces", "Active, 7 days"]} />
                <tbody className="divide-y divide-rule">
                  {report.clients.map((row) => (
                    <tr key={row.client}>
                      <td className={cx("max-w-56 py-2.5 pr-3 pl-5", PINNED_CELL)}>
                        <p className="font-semibold text-ink">{row.client}</p>
                        {row.names.length > 0 && <p className="truncate text-xs text-muted">{row.names.join(", ")}</p>}
                      </td>
                      <td className={NUM}>
                        <Figure value={row.live} className="font-semibold text-ink" />
                        <span className="block text-xs text-muted">of {row.agents}</span>
                      </td>
                      <td className={NUM}>
                        <Figure value={row.byLevel.admin} />
                      </td>
                      <td className={NUM}>
                        <Figure value={row.byLevel.write} />
                      </td>
                      <td className={NUM}>
                        <Figure value={row.byLevel.read} />
                      </td>
                      <td className={NUM}>
                        <Figure value={row.subagents} />
                      </td>
                      <td className={NUM}>
                        <Figure value={row.workspaces} />
                      </td>
                      <td className={cx(NUM, "pr-5")}>
                        <Figure value={row.activeLastWeek} className="font-semibold text-arrive-ink" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>

        <TrendCard
          title="Active agents"
          definition="Agents other than the pipelines agent with at least one event as the actor, or one MCP tool call, in the 7 days."
          windows={report.windows}
          values={report.activeAgents}
        />

        <Card className="lg:col-span-3">
          <CardHeader title={`MCP tools, last ${REPORT_DAYS} days`} description="Calls counted per day by the MCP endpoint (tool_calls_daily): never the input or the result. An error is a result marked as one, a refusal included." />
          {report.tools.length === 0 ? (
            <EmptyState icon={<Wrench />} title="No tool calls counted yet">
              Calls are counted from the release that added this page on.
            </EmptyState>
          ) : (
            <TableScroll label="MCP tools by calls">
              <table className="w-full text-sm">
                <caption className="sr-only">MCP tools by calls</caption>
                <Head labels={["Tool", "Calls", "Errors", "Error rate", "Agents", "Workspaces"]} />
                <tbody className="divide-y divide-rule">
                  {report.tools.map((tool) => (
                    <tr key={tool.tool}>
                      <td className={cx("py-2.5 pr-3 pl-5 font-mono text-xs text-ink", PINNED_CELL)}>{tool.tool}</td>
                      <td className={NUM}>
                        <Figure value={tool.calls} className="font-semibold text-ink" />
                      </td>
                      <td className={NUM}>
                        <Figure value={tool.errors} className="text-late-ink" />
                      </td>
                      <td className={cx(NUM, "text-xs text-ink-2")}>{tool.calls ? percent(tool.errors / tool.calls) : "None"}</td>
                      <td className={NUM}>
                        <Figure value={tool.agents} />
                      </td>
                      <td className={cx(NUM, "pr-5")}>
                        <Figure value={tool.workspaces} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>
      </div>
    </>
  );
}
