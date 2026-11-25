import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pager, TableScroll, TwoFactorGate } from "@/components/backoffice/parts";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { cx } from "@/lib/cx";
import { countLabel, DELETION_COUNTS } from "@/lib/workspace-deletion";
import { queryParam } from "@/lib/routes";
import { adminPaths } from "@/server/backoffice/paths";
import { listAuditLog } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";

export const metadata: Metadata = { title: "Audit" };

const when = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/** What an audit action reads as. */
const ACTION_LABELS: Record<string, string> = {
  "view.overview": "Viewed the overview",
  "view.activation": "Viewed activation",
  "view.workspaces": "Viewed workspaces",
  "export.workspaces": "Exported workspaces",
  "view.workspace": "Viewed a workspace",
  "content.reveal": "Showed content",
  "view.workspace_content": "Read content",
  "view.workspace_app": "Opened the workspace",
  "view.people": "Searched people",
  "view.agents": "Viewed agents",
  "view.usage": "Viewed usage",
  "view.health": "Viewed health",
  "view.audit": "Viewed the audit log",
};

/** Filters as "q: acme · sort: name", leaving out defaults nobody chose. */
function describeFilters(filters: Record<string, unknown>): string {
  return Object.entries(filters)
    .filter(([key, value]) => value !== undefined && value !== "" && !(key === "page" && value === 1))
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const access = await requireBackoffice();
  if (access.refusal) return <TwoFactorGate />;
  const page = Math.max(1, Number.parseInt(queryParam((await searchParams).page) ?? "1", 10) || 1);
  const log = await listAuditLog(access.ctx, { page });

  return (
    <>
      <PageHeader title="Audit" description="Every look at the backoffice: who, what, when, with which filters, and why for content. Times are UTC. Nothing here can be changed or deleted from the app." />
      <Card>
        {log.rows.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="Nothing recorded yet" />
        ) : (
          <>
            <TableScroll label="Audit log">
              <table className="w-full text-sm">
                <caption className="sr-only">Audit log, newest first</caption>
                <thead>
                  <tr className="border-b border-rule">
                    {["When", "Who", "What", "About", "Filters and reason"].map((label, index) => (
                      <th key={label} scope="col" className={cx(TH, "text-left", index === 0 && cx("pl-5", PINNED_CELL), index === 4 && "pr-5")}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {log.rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className={cx("py-2.5 pr-3 pl-5 text-xs whitespace-nowrap text-ink-2", PINNED_CELL)}>{when.format(row.at)}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">{row.adminEmail}</td>
                      <td className={cx("px-3 py-2.5 text-xs whitespace-nowrap", row.action === "content.reveal" ? "font-semibold text-wait-ink" : "text-ink")}>{ACTION_LABELS[row.action] ?? row.action}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {row.tenantSlug ? (
                          <Link href={adminPaths.workspace(row.tenantSlug)} className="link text-ink">
                            {row.tenantName}
                          </Link>
                        ) : row.subjectEmail ? (
                          <span className="text-ink-2">{row.subjectEmail}</span>
                        ) : (
                          <span className="text-muted">None</span>
                        )}
                      </td>
                      <td className="max-w-md py-2.5 pr-5 pl-3 text-xs text-ink-2">
                        {row.reason && <p className="wrap-anywhere text-ink">“{row.reason}”</p>}
                        <p className="wrap-anywhere text-muted">{describeFilters(row.filters) || "No filters"}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pager page={log.page} pageSize={log.pageSize} total={log.total} noun="entries" href={(next) => adminPaths.audit(next)} />
          </>
        )}
      </Card>
      <Card className="mt-6">
        <CardHeader title="Deleted workspaces" description="Workspaces their owners deleted, with everything in them, newest first: recorded before the deletion, and kept when nothing else of the workspace is." />
        {log.deletions.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="No workspace deleted yet" />
        ) : (
          <TableScroll label="Deleted workspaces">
            <table className="w-full text-sm">
              <caption className="sr-only">Deleted workspaces, newest first</caption>
              <thead>
                <tr className="border-b border-rule">
                  {["When", "Workspace", "Deleted by", "What went with it", "Files"].map((label, index) => (
                    <th key={label} scope="col" className={cx(TH, "text-left", index === 0 && cx("pl-5", PINNED_CELL), index === 4 && "pr-5")}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {log.deletions.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className={cx("py-2.5 pr-3 pl-5 text-xs whitespace-nowrap text-ink-2", PINNED_CELL)}>{when.format(row.at)}</td>
                    <td className="px-3 py-2.5 text-xs">
                      <p className="font-semibold wrap-anywhere text-ink">{row.name}</p>
                      <p className="text-muted">/w/{row.slug}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-2">{row.deletedByEmail}</td>
                    <td className="max-w-md px-3 py-2.5 text-xs text-ink-2">{DELETION_COUNTS.map((kind) => countLabel(kind, row.counts[kind] ?? 0)).join(" · ")}</td>
                    <td className="py-2.5 pr-5 pl-3 text-xs whitespace-nowrap text-ink-2">{row.blobsClearedAt ? "Deleted" : "Pending"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </>
  );
}
