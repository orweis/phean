import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { FlowBar } from "@/components/charts/flow-bar";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";
import { PageHeader } from "@/components/page-header";
import { MetaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Stat, StatStrip } from "@/components/ui/stat";
import { OPEN_TASK_STATUSES, ROLE_META } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { getViewer, visibleWorkspaces } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getWorkspaceOverviews, type WorkspaceOverview } from "@/server/domain/tenants";

export const metadata: Metadata = { title: "Workspaces" };

const COLUMNS: { label: string; value: (row: WorkspaceOverview) => number; alert?: "late" | "wait" }[] = [
  { label: "Late", value: (row) => row.overdue, alert: "late" },
  { label: "Due this week", value: (row) => row.dueThisWeek },
  { label: "Done, 7 days", value: (row) => row.doneLast7Days },
  { label: "Awaiting decision", value: (row) => row.pendingApprovals, alert: "wait" },
];

const ALERT_TEXT = { late: "font-bold text-late-ink", wait: "font-bold text-wait-ink" } as const;
const TH = "px-3 py-2.5 text-xs font-semibold whitespace-nowrap text-muted";

function sum(rows: readonly WorkspaceOverview[], pick: (row: WorkspaceOverview) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

export default async function WorkspacesPage() {
  const viewer = await getViewer();
  const rows = await getWorkspaceOverviews(getDb(), await visibleWorkspaces(viewer));
  const late = sum(rows, (row) => row.overdue);

  return (
    <>
      <AppHeader user={viewer.user} />
      <AutoRefresh />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <PageHeader
          title="Workspaces"
          description={
            viewer.platformAdmin
              ? "Status across every customer workspace. You have read-only access to workspaces you are not a member of."
              : "Status across every workspace you belong to. Each workspace has its own goals, tasks, memory, and agents."
          }
        />

        {rows.length > 0 && (
          <StatStrip className="grid-cols-2 sm:grid-cols-4">
            <Stat label="Workspaces" value={rows.length} />
            <Stat label="Open tasks" value={sum(rows, (row) => row.openTasks)} />
            <Stat label="Late" value={late} tone={late ? "danger" : undefined} hint="past due, still open" />
            <Stat label="Agents active" value={sum(rows, (row) => row.activeAgents)} hint={`of ${sum(rows, (row) => row.agents)} connected, last 24 hours`} />
          </StatStrip>
        )}

        <Card>
          <CardHeader title="Status per workspace" description="Open work by status, then what is late and what waits on a decision. Refreshes every 15 seconds." />
          {rows.length === 0 ? (
            <EmptyState icon={<Building2 />} title="No workspaces yet">
              Create your first workspace below, then connect an agent to it.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule">
                    <th className={cx(TH, "pl-5 text-left")}>Workspace</th>
                    <th className={cx(TH, "min-w-48 text-left")}>Open work</th>
                    {COLUMNS.map((column) => (
                      <th key={column.label} className={cx(TH, "text-right")}>
                        {column.label}
                      </th>
                    ))}
                    <th className={cx(TH, "text-right")}>Agents</th>
                    <th className={cx(TH, "pr-5 text-right")}>Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map((row) => (
                    <tr key={row.tenant.id} className="transition-colors duration-(--dur-micro) hover:bg-sunken/60">
                      <td className="py-3 pr-3 pl-5">
                        <Link href={routes.workspace(row.tenant.slug)} className="font-semibold text-ink hover:underline">
                          {row.tenant.name}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                          /w/{row.tenant.slug}
                          <MetaBadge meta={ROLE_META} value={row.role} />
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <FlowBar
                            counts={row.tasksByStatus}
                            stations={OPEN_TASK_STATUSES}
                            size="md"
                            label={`${row.tenant.name} open work`}
                            className="flex-1"
                          />
                          <span className="w-6 text-right font-semibold text-ink">{row.openTasks}</span>
                        </div>
                      </td>
                      {COLUMNS.map((column) => {
                        const value = column.value(row);
                        return (
                          <td key={column.label} className={cx("px-3 py-3 text-right", value === 0 ? "text-muted" : column.alert ? ALERT_TEXT[column.alert] : "text-ink")}>
                            {value}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <span className={row.activeAgents ? "font-semibold text-arrive-ink" : "text-muted"}>{row.activeAgents}</span>
                        <span className="text-muted"> of {row.agents}</span>
                      </td>
                      <td className="py-3 pr-5 pl-3 text-right text-xs whitespace-nowrap text-muted">{timeAgo(row.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="New workspace" description="One per team or customer. You become its owner." />
          <CardBody>
            <CreateWorkspaceForm />
          </CardBody>
        </Card>
      </main>
    </>
  );
}
