import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppHeader } from "@/components/app-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";
import { MetaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Stat } from "@/components/ui/stat";
import { ROLE_META } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { getViewer, visibleWorkspaces } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getWorkspaceOverviews, type WorkspaceOverview } from "@/server/domain/tenants";

export const metadata: Metadata = { title: "Workspaces" };

const COLUMNS: { label: string; value: (row: WorkspaceOverview) => number; alert?: "danger" | "warning" }[] = [
  { label: "Open", value: (row) => row.openTasks },
  { label: "Inbox", value: (row) => row.inbox },
  { label: "Overdue", value: (row) => row.overdue, alert: "danger" },
  { label: "Due this week", value: (row) => row.dueThisWeek },
  { label: "Done (7d)", value: (row) => row.doneLast7Days },
  { label: "Awaiting approval", value: (row) => row.pendingApprovals, alert: "warning" },
];

function sum(rows: readonly WorkspaceOverview[], pick: (row: WorkspaceOverview) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

export default async function WorkspacesPage() {
  const viewer = await getViewer();
  const rows = await getWorkspaceOverviews(getDb(), await visibleWorkspaces(viewer));

  return (
    <>
      <AppHeader user={viewer.user} />
      <AutoRefresh />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Workspaces</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {viewer.platformAdmin
              ? "Status across every customer workspace. You have read-only access to workspaces you are not a member of."
              : "Status across every workspace you belong to. Each workspace has its own goals, tasks, memory, and agents."}
          </p>
        </div>

        {rows.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Workspaces" value={rows.length} />
            <Stat label="Open tasks" value={sum(rows, (row) => row.openTasks)} />
            <Stat label="Overdue" value={sum(rows, (row) => row.overdue)} tone={sum(rows, (row) => row.overdue) ? "danger" : undefined} />
            <Stat
              label="Active agents (24h)"
              value={sum(rows, (row) => row.activeAgents)}
              hint={`of ${sum(rows, (row) => row.agents)} connected`}
            />
          </div>
        )}

        <Card>
          <CardHeader title="Status per workspace" description="Refreshes automatically every 15 seconds." icon={<Building2 />} />
          {rows.length === 0 ? (
            <EmptyState icon={<Building2 />} title="No workspaces yet">
              Create your first workspace below, then connect an agent to it.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                    <th className="px-5 py-2.5 font-medium">Workspace</th>
                    {COLUMNS.map((column) => (
                      <th key={column.label} className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                        {column.label}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-medium">Agents</th>
                    <th className="px-5 py-2.5 text-right font-medium whitespace-nowrap">Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map((row) => (
                    <tr key={row.tenant.id} className="hover:bg-zinc-50">
                      <td className="px-5 py-3">
                        <Link href={routes.workspace(row.tenant.slug)} className="font-medium text-zinc-900 hover:underline">
                          {row.tenant.name}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-400">
                          /w/{row.tenant.slug}
                          <MetaBadge meta={ROLE_META} value={row.role} />
                        </div>
                      </td>
                      {COLUMNS.map((column) => {
                        const value = column.value(row);
                        return (
                          <td
                            key={column.label}
                            className={cx(
                              "px-3 py-3 text-right tabular-nums",
                              value === 0 && "text-zinc-300",
                              value > 0 && column.alert === "danger" && "font-semibold text-red-600",
                              value > 0 && column.alert === "warning" && "font-semibold text-amber-600",
                            )}
                          >
                            {value}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                        <span className={row.activeAgents ? "text-emerald-600" : "text-zinc-400"}>{row.activeAgents}</span>
                        <span className="text-zinc-400"> / {row.agents}</span>
                      </td>
                      <td className="px-5 py-3 text-right text-xs whitespace-nowrap text-zinc-500">{timeAgo(row.lastActivityAt)}</td>
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
