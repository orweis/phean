import { notFound } from "next/navigation";

import { HEALTH_FLAGS, SORT_DIRECTIONS, toCsv, WORKSPACE_SORTS } from "@/lib/backoffice";
import { todayIso } from "@/lib/dates";
import { isOneOf } from "@/lib/domain";
import { exportWorkspaces } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";

const HEADER = [
  "Workspace",
  "URL",
  "Created",
  "Owner email",
  "Members",
  "Agents",
  "Admin agents",
  "Write agents",
  "Read agents",
  "Sub-agents",
  "Clients",
  "Open tasks",
  "Done tasks",
  "Open decisions",
  "Answered, 28 days",
  "Median answer, 28 days (hours)",
  "Pipelines",
  "Runs",
  "Failed runs",
  "Last activity",
  "Health",
];

/**
 * The Workspaces table as CSV, with the filters it was opened with, every page of it. Platform admins
 * only (anyone else gets a 404, as for the pages); each export is recorded in the audit log.
 */
export async function GET(request: Request): Promise<Response> {
  const access = await requireBackoffice();
  if (access.refusal) notFound();
  const params = new URL(request.url).searchParams;
  const pick = <T extends string>(values: readonly T[], name: string) => {
    const value = params.get(name) ?? undefined;
    return isOneOf(values, value) ? value : undefined;
  };
  const { rows } = await exportWorkspaces(access.ctx, {
    q: params.get("q")?.trim() || undefined,
    sort: pick(WORKSPACE_SORTS, "sort"),
    dir: pick(SORT_DIRECTIONS, "dir"),
    health: pick(HEALTH_FLAGS, "health"),
  });
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  const csv = toCsv([
    HEADER,
    ...rows.map((row) => [
      row.name,
      row.slug,
      iso(row.createdAt),
      row.ownerEmail,
      row.members,
      row.agents,
      row.agentsByLevel.admin,
      row.agentsByLevel.write,
      row.agentsByLevel.read,
      row.subagents,
      row.clients.join("; "),
      row.openTasks,
      row.doneTasks,
      row.openDecisions,
      row.answered,
      row.medianAnswerMs === null ? null : Math.round((row.medianAnswerMs / 3_600_000) * 10) / 10,
      row.pipelines,
      row.runs,
      row.failedRuns,
      iso(row.lastActivityAt),
      row.flags.join("; "),
    ]),
  ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="phean-workspaces-${todayIso()}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
