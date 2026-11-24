import { Building2, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Figure, Pager, SortHeader, TableScroll, TwoFactorGate } from "@/components/backoffice/parts";
import { PageHeader } from "@/components/page-header";
import { QueryFilter } from "@/components/query-filter";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { defaultDirection, HEALTH_FLAGS, HEALTH_META, SORT_DIRECTIONS, WORKSPACE_SORT_LABELS, WORKSPACE_SORTS, type WorkspaceSort } from "@/lib/backoffice";
import { cx } from "@/lib/cx";
import { isOneOf } from "@/lib/domain";
import { formatDuration, timeAgo } from "@/lib/format";
import { queryParam } from "@/lib/routes";
import { adminPaths } from "@/server/backoffice/paths";
import { listWorkspaces } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";

export const metadata: Metadata = { title: "Workspaces" };

const day = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Columns that sort, in table order after the workspace's own. */
const SORTED: WorkspaceSort[] = ["created", "members", "agents", "open_tasks", "open_decisions", "last_activity"];

export default async function AdminWorkspacesPage({ searchParams }: PageProps<"/admin/workspaces">) {
  const access = await requireBackoffice();
  if (access.refusal) return <TwoFactorGate />;
  const params = await searchParams;
  const q = queryParam(params.q);
  const sortParam = queryParam(params.sort);
  const sort: WorkspaceSort = isOneOf(WORKSPACE_SORTS, sortParam) ? sortParam : "created";
  const dirParam = queryParam(params.dir);
  const dir = isOneOf(SORT_DIRECTIONS, dirParam) ? dirParam : defaultDirection(sort);
  const healthParam = queryParam(params.health);
  const health = isOneOf(HEALTH_FLAGS, healthParam) ? healthParam : undefined;
  const page = Math.max(1, Number.parseInt(queryParam(params.page) ?? "1", 10) || 1);

  const result = await listWorkspaces(access.ctx, { q, sort, dir, health, page });
  const hrefFor = (query: Record<string, string | undefined>) => adminPaths.workspaces({ q, sort, dir, health, ...query });
  const sortHref = (column: WorkspaceSort) => {
    const next = column === sort ? (dir === "asc" ? "desc" : "asc") : defaultDirection(column);
    return { href: hrefFor({ sort: column, dir: next, page: undefined }), next };
  };

  return (
    <>
      <PageHeader
        title="Workspaces"
        description="Every customer workspace with its figures. Search names, URLs and owners' emails; sort by any column; filter by what needs attention. The export holds every row these filters choose, and is recorded."
        actions={
          <a href={adminPaths.workspacesExport({ q, sort, dir, health })} download className={buttonClasses("secondary", "md")}>
            <Download aria-hidden />
            Export CSV
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72">
          <SearchForm action={adminPaths.workspaces()} defaultValue={q} placeholder="Name, URL or owner email" label="Search workspaces" keep={{ sort, dir, health }} />
        </div>
        <QueryFilter name="health" label="Health" description="Filter by health" resets={["page"]} className="max-sm:w-full">
          <option value="">Any</option>
          {HEALTH_FLAGS.map((flag) => (
            <option key={flag} value={flag}>
              {HEALTH_META[flag].label}
            </option>
          ))}
        </QueryFilter>
      </div>

      <Card>
        {result.rows.length === 0 ? (
          <EmptyState icon={<Building2 />} title={q || health || page > 1 ? "No workspaces match" : "No workspaces yet"}>
            {q || health || page > 1 ? "Try other words, another health filter, or the first page." : "Workspaces appear here as people create them."}
          </EmptyState>
        ) : (
          <>
            <TableScroll label="Workspaces">
              <table className="w-full text-sm">
                <caption className="sr-only">{`Workspaces, sorted by ${WORKSPACE_SORT_LABELS[sort].toLowerCase()}, ${dir === "asc" ? "ascending" : "descending"}`}</caption>
                <thead>
                  <tr className="border-b border-rule">
                    <SortHeader label="Workspace" first align="left" active={sort === "name"} direction={dir} {...sortHref("name")} />
                    {SORTED.map((column) => (
                      <SortHeader key={column} label={WORKSPACE_SORT_LABELS[column]} active={sort === column} direction={dir} {...sortHref(column)} />
                    ))}
                    <th scope="col" className={cx(TH, "text-right")}>
                      Answered, 28 days
                    </th>
                    <th scope="col" className={cx(TH, "text-right")}>
                      Pipelines
                    </th>
                    <th scope="col" className={cx(TH, "pr-5 text-left")}>
                      Health
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {result.rows.map((row) => (
                    <tr key={row.id} className="align-top transition-colors duration-(--dur-micro) hover:bg-fill">
                      <td className={cx("max-w-64 py-3 pr-3 pl-5", PINNED_CELL)}>
                        <Link href={adminPaths.workspace(row.slug)} className="link block truncate font-semibold text-ink">
                          {row.name}
                        </Link>
                        <p className="truncate text-xs text-muted">/w/{row.slug}</p>
                        {row.ownerEmail && <p className="truncate text-xs text-ink-2">{row.ownerEmail}</p>}
                      </td>
                      <td className="px-3 py-3 text-right text-xs whitespace-nowrap text-ink-2">{day.format(row.createdAt)}</td>
                      <td className="px-3 py-3 text-right">
                        <Figure value={row.members} />
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <Figure value={row.agents} className="font-semibold text-ink" />
                        {row.agents > 0 && (
                          <p className="text-xs text-muted">
                            {[row.agentsByLevel.admin && `${row.agentsByLevel.admin} admin`, row.agentsByLevel.write && `${row.agentsByLevel.write} write`, row.agentsByLevel.read && `${row.agentsByLevel.read} read`]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {row.clients.length > 0 && <p className="max-w-40 truncate text-xs text-muted">{row.clients.join(", ")}</p>}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <Figure value={row.openTasks} className="font-semibold text-ink" />
                        <p className="text-xs text-muted">{row.doneTasks.toLocaleString("en")} done</p>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Figure value={row.openDecisions} className="font-semibold text-wait-ink" />
                      </td>
                      <td className="px-3 py-3 text-right text-xs whitespace-nowrap text-ink-2">{timeAgo(row.lastActivityAt ? new Date(row.lastActivityAt) : null)}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <Figure value={row.answered} />
                        {row.medianAnswerMs !== null && <p className="text-xs whitespace-nowrap text-muted">median {formatDuration(row.medianAnswerMs)}</p>}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <Figure value={row.pipelines} />
                        {row.runs > 0 && (
                          <p className="text-xs text-muted">
                            {row.runs} runs{row.failedRuns > 0 && `, ${row.failedRuns} failed`}
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-5 pl-3">
                        {row.flags.length === 0 ? (
                          <span className="text-xs text-muted">Fine</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {row.flags.map((flag) => (
                              <Badge key={flag} tone={HEALTH_META[flag].tone}>
                                {HEALTH_META[flag].label}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pager page={result.page} pageSize={result.pageSize} total={result.total} noun="workspaces" href={(next) => hrefFor({ page: String(next) })} />
          </>
        )}
      </Card>
    </>
  );
}
