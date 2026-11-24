import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  BACKOFFICE_PAGE_SIZE,
  clientFamily,
  CONTENT_REASON_MAX,
  CONTENT_REASON_MIN,
  defaultDirection,
  DORMANT_DAYS,
  EXPORT_LIMIT,
  FAILING_WEBHOOK_STREAK,
  HEALTH_FLAGS,
  healthFlags,
  median,
  REPORT_DAYS,
  SORT_DIRECTIONS,
  STUCK_DECISION_DAYS,
  WORKSPACE_SORTS,
  type ClientFamily,
  type HealthFlag,
  type WorkspaceSort,
} from "@/lib/backoffice";
import { addDays, dayOf, isoDate, todayIso } from "@/lib/dates";
import { OPEN_TASK_STATUSES, type AgentAccessLevel, type TaskStatus } from "@/lib/domain";

import type { Db } from "../db/client";
import { queryRows } from "../db/raw";
import { organization, tasks } from "../db/schema";
import { DomainError, forbidden } from "../domain/errors";
import { CONTENT_REVEAL, contentGrant } from "./audit";
import type { PlatformCtx } from "./context";
import { answerDurations, containsPattern, epochMs } from "./queries";
import { usageSource } from "./rollup";
import { platformService } from "./service";

// ------------------------------------------------------------------------------------------------ table

export const WorkspaceFilters = z.object({
  q: z.string().trim().max(120).optional(),
  sort: z.enum(WORKSPACE_SORTS).default("created"),
  dir: z.enum(SORT_DIRECTIONS).optional(),
  health: z.enum(HEALTH_FLAGS).optional(),
});

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  ownerEmail: string | null;
  members: number;
  agents: number;
  agentsByLevel: Record<AgentAccessLevel, number>;
  subagents: number;
  clients: ClientFamily[];
  openTasks: number;
  doneTasks: number;
  openDecisions: number;
  /** Requests a person answered in the last `REPORT_DAYS` days, and their median time to answer. */
  answered: number;
  medianAnswerMs: number | null;
  pipelines: number;
  runs: number;
  failedRuns: number;
  lastActivityAt: number | null;
  flags: HealthFlag[];
}

interface RawWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  ownerEmail: string | null;
  members: number;
  agents: number;
  readAgents: number;
  writeAgents: number;
  adminAgents: number;
  subagents: number;
  clients: { authKind: string; clientName: string | null; sharesParentKey: boolean }[] | null;
  openTasks: number;
  doneTasks: number;
  openDecisions: number;
  oldestRequestAt: number | null;
  answered: number;
  medianAnswerMs: number | null;
  pipelines: number;
  runs: number;
  failedRuns: number;
  webhooksDisabled: number;
  maxWebhookFailures: number;
  lastActivityAt: number | null;
  total: number;
}

const SORT_COLUMNS: Record<WorkspaceSort, SQL> = {
  created: sql`o.created_at`,
  name: sql`lower(o.name)`,
  members: sql`coalesce(mem.members, 0)`,
  agents: sql`coalesce(ag.agents, 0)`,
  open_tasks: sql`coalesce(tk.open_tasks, 0)`,
  open_decisions: sql`coalesce(tk.open_decisions, 0)`,
  last_activity: sql`last.at`,
};

const daysAgo = (days: number) => sql`now() - make_interval(days => ${days})`;

/** The SQL twin of `healthFlags`, so the filter and the pages agree, and paging stays in the database. */
const HEALTH_WHERE: Record<HealthFlag, SQL> = {
  dormant: sql`o.created_at < ${daysAgo(DORMANT_DAYS)} and (last.at is null or last.at < ${daysAgo(DORMANT_DAYS)})`,
  stuck_decisions: sql`tk.oldest_request < ${daysAgo(STUCK_DECISION_DAYS)}`,
  failing_webhooks: sql`(coalesce(wh.disabled, 0) > 0 or coalesce(wh.max_failures, 0) >= ${FAILING_WEBHOOK_STREAK})`,
};

/**
 * Every workspace's figures in one statement: each table is aggregated once per tenant (members,
 * agents, tasks, answers, pipelines, runs, webhooks), the last event comes from
 * `events_tenant_created_idx`, then the chosen column sorts and the page is cut in the database.
 */
async function workspaceRows(db: Db, filters: z.output<typeof WorkspaceFilters>, limit: number, offset: number): Promise<{ rows: WorkspaceRow[]; total: number }> {
  const direction = (filters.dir ?? defaultDirection(filters.sort)) === "asc" ? sql`asc` : sql`desc`;
  const conditions: SQL[] = [];
  if (filters.q) {
    const pattern = containsPattern(filters.q);
    conditions.push(sql`(o.name ilike ${pattern} or o.slug ilike ${pattern} or owner.email ilike ${pattern})`);
  }
  if (filters.health) conditions.push(HEALTH_WHERE[filters.health]);
  const where = conditions.length ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const open = sql.join(OPEN_TASK_STATUSES.map((status) => sql`${status}`), sql`, `);

  const raw = await queryRows<RawWorkspaceRow>(
    db,
    sql`with
      mem as (select organization_id as tenant_id, count(*)::int as members from member group by 1),
      owner as (select distinct on (m.organization_id) m.organization_id as tenant_id, u.email
                from member m join "user" u on u.id = m.user_id where m.role = 'owner' order by m.organization_id, m.created_at),
      live as (select a.tenant_id, a.access_level, a.parent_agent_id, a.auth_kind, a.shares_parent_key, c.name as client_name
               from agents a left join oauth_client c on c.client_id = a.oauth_client_id
               where a.auth_kind <> 'system' and a.revoked_at is null and (a.access_expires_at is null or a.access_expires_at > now())),
      ag as (select tenant_id, count(*)::int as agents,
               count(*) filter (where access_level = 'read')::int as read_agents,
               count(*) filter (where access_level = 'write')::int as write_agents,
               count(*) filter (where access_level = 'admin')::int as admin_agents,
               count(*) filter (where parent_agent_id is not null)::int as subagents,
               jsonb_agg(distinct jsonb_build_object('authKind', auth_kind, 'clientName', client_name, 'sharesParentKey', shares_parent_key)) as clients
             from live group by 1),
      tk as (select tenant_id,
               count(*) filter (where status in (${open}))::int as open_tasks,
               count(*) filter (where status = 'done')::int as done_tasks,
               count(*) filter (where input_request is not null)::int as open_decisions,
               min((input_request->>'askedAt')::timestamptz) as oldest_request
             from tasks group by 1),
      ans as (select t.tenant_id, count(*)::int as answered,
                percentile_cont(0.5) within group (order by extract(epoch from ((a->>'closedAt')::timestamptz - (a->>'askedAt')::timestamptz))) * 1000 as median_ms
              from tasks t cross join lateral jsonb_array_elements(t.input_answers) as a
              where t.input_answers <> '[]'::jsonb and t.updated_at >= ${daysAgo(REPORT_DAYS)}
                and a->>'outcome' in ('answered', 'answered_elsewhere') and (a->>'closedAt')::timestamptz >= ${daysAgo(REPORT_DAYS)}
              group by 1),
      pl as (select tenant_id, count(*)::int as pipelines from pipelines group by 1),
      runs as (select tenant_id, count(*)::int as runs, count(*) filter (where status = 'failed')::int as failed_runs from pipeline_runs group by 1),
      wh as (select tenant_id, count(*) filter (where status = 'disabled')::int as disabled, max(consecutive_failures)::int as max_failures from webhooks group by 1)
    select o.id, o.name, o.slug, ${epochMs(sql`o.created_at`)} as "createdAt", owner.email as "ownerEmail",
      coalesce(mem.members, 0) as members, coalesce(ag.agents, 0) as agents,
      coalesce(ag.read_agents, 0) as "readAgents", coalesce(ag.write_agents, 0) as "writeAgents", coalesce(ag.admin_agents, 0) as "adminAgents",
      coalesce(ag.subagents, 0) as subagents, ag.clients,
      coalesce(tk.open_tasks, 0) as "openTasks", coalesce(tk.done_tasks, 0) as "doneTasks", coalesce(tk.open_decisions, 0) as "openDecisions",
      ${epochMs(sql`tk.oldest_request`)} as "oldestRequestAt",
      coalesce(ans.answered, 0) as answered, ans.median_ms::float8 as "medianAnswerMs",
      coalesce(pl.pipelines, 0) as pipelines, coalesce(runs.runs, 0) as runs, coalesce(runs.failed_runs, 0) as "failedRuns",
      coalesce(wh.disabled, 0) as "webhooksDisabled", coalesce(wh.max_failures, 0) as "maxWebhookFailures",
      ${epochMs(sql`last.at`)} as "lastActivityAt",
      count(*) over ()::int as total
    from organization o
      left join owner on owner.tenant_id = o.id
      left join mem on mem.tenant_id = o.id
      left join ag on ag.tenant_id = o.id
      left join tk on tk.tenant_id = o.id
      left join ans on ans.tenant_id = o.id
      left join pl on pl.tenant_id = o.id
      left join runs on runs.tenant_id = o.id
      left join wh on wh.tenant_id = o.id
      left join lateral (select e.created_at as at from events e left join agents a on e.actor_type = 'agent' and a.id = e.actor_id
                         where e.tenant_id = o.id and a.auth_kind is distinct from 'system' order by e.created_at desc limit 1) as last on true
    ${where}
    order by ${SORT_COLUMNS[filters.sort]} ${direction} nulls last, o.id
    limit ${limit} offset ${offset}`,
  );

  const now = Date.now();
  const nullable = (value: number | null) => (value === null ? null : Number(value));
  const rows = raw.map((row): WorkspaceRow => {
    const createdAt = Number(row.createdAt);
    const lastActivityAt = nullable(row.lastActivityAt);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt,
      ownerEmail: row.ownerEmail,
      members: Number(row.members),
      agents: Number(row.agents),
      agentsByLevel: { read: Number(row.readAgents), write: Number(row.writeAgents), admin: Number(row.adminAgents) },
      subagents: Number(row.subagents),
      clients: [...new Set((row.clients ?? []).map(clientFamily))].sort(),
      openTasks: Number(row.openTasks),
      doneTasks: Number(row.doneTasks),
      openDecisions: Number(row.openDecisions),
      answered: Number(row.answered),
      medianAnswerMs: nullable(row.medianAnswerMs),
      pipelines: Number(row.pipelines),
      runs: Number(row.runs),
      failedRuns: Number(row.failedRuns),
      lastActivityAt,
      flags: healthFlags(
        {
          createdAt,
          lastActivityAt,
          oldestOpenRequestAt: nullable(row.oldestRequestAt),
          webhooksDisabled: Number(row.webhooksDisabled),
          maxWebhookFailures: Number(row.maxWebhookFailures),
        },
        now,
      ),
    };
  });
  return { rows, total: raw.length ? Number(raw[0]!.total) : 0 };
}

const ListInput = WorkspaceFilters.extend({ page: z.coerce.number().int().min(1).max(10_000).default(1) });

/** One page of the Workspaces table: search, sort, health filter. */
export const listWorkspaces = platformService("view.workspaces", ListInput, async (ctx, input) => {
  const { rows, total } = await workspaceRows(ctx.db, input, BACKOFFICE_PAGE_SIZE, (input.page - 1) * BACKOFFICE_PAGE_SIZE);
  return { rows, total, page: input.page, pageSize: BACKOFFICE_PAGE_SIZE };
});

/** The same rows, every page (up to `EXPORT_LIMIT`), for the CSV export. Recorded as an export. */
export const exportWorkspaces = platformService("export.workspaces", WorkspaceFilters, async (ctx, input) => {
  const { rows, total } = await workspaceRows(ctx.db, input, EXPORT_LIMIT, 0);
  return { rows, total, truncated: total > rows.length };
});

// ----------------------------------------------------------------------------------------------- detail

const SlugInput = z.object({ slug: z.string().trim().min(1).max(100) });

async function tenantBySlug(ctx: PlatformCtx, slug: string) {
  const [tenant] = await ctx.db
    .select({ id: organization.id, name: organization.name, slug: organization.slug, createdAt: organization.createdAt })
    .from(organization)
    .where(eq(organization.slug, slug));
  if (!tenant) throw new DomainError("not_found", `No workspace "${slug}".`);
  return tenant;
}

export interface WorkspaceDetail {
  tenant: { id: string; name: string; slug: string; createdAt: Date };
  members: { name: string; email: string; role: string; joinedAt: number; twoFactor: boolean; emailVerified: boolean }[];
  agents: {
    id: string;
    name: string;
    authKind: string;
    level: AgentAccessLevel;
    client: ClientFamily;
    clientName: string | null;
    parentAgentId: string | null;
    createdAt: number;
    lastSeenAt: number | null;
    state: "live" | "revoked" | "expired";
    approvedBy: string | null;
    calls: number;
    errors: number;
  }[];
  tasksByStatus: Partial<Record<TaskStatus, number>>;
  activity: { days: string[]; perDay: number[]; byAction: { action: string; events: number; actors: number }[] };
  decisions: { open: number; oldestOpenAt: number | null; asked: number; answered: number; medianAnswerMs: number | null; answersTimed: number };
  pipelines: { id: string; name: string; kind: string; status: string; runs: Record<string, number>; lastRunAt: number | null }[];
  webhooks: {
    agentName: string;
    host: string;
    status: string;
    topics: string[];
    scope: string;
    failures: number;
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
    lastStatus: number | null;
    deliveries: Record<string, number>;
  }[];
  push: { devices: number; people: number; mutes: number; deliveries: Record<string, number> };
  storage: { documents: number; bytes: number; byFormat: { format: string; documents: number; bytes: number }[] };
  memories: number;
  goals: number;
  grant: { until: Date; reason: string } | null;
}

/** The host of a webhook URL, never its path or query (automation platforms put tokens there). */
export function webhookHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid URL";
  }
}

/**
 * One workspace's metadata: members, agents, activity, decisions, pipelines, webhooks, push and
 * storage. No content: titles, questions, answers and memories wait for "Show content".
 */
export const getWorkspaceDetail = platformService(
  "view.workspace",
  SlugInput,
  async (ctx, { slug }): Promise<WorkspaceDetail> => {
    const tenant = await tenantBySlug(ctx, slug);
    const db = ctx.db;
    const now = new Date();
    const today = todayIso(now);
    const fromDay = isoDate(addDays(dayOf(today), -(REPORT_DAYS - 1)));
    const from = dayOf(fromDay).toISOString();
    const id = tenant.id;
    const source = await usageSource(db, fromDay, now);

    const [members, agentRows, statusRows, activityRows, actorRows, decisionRow, answers, pipelineRows, webhookRows, pushRow, storageRows, counts, grant] = await Promise.all([
      queryRows<WorkspaceDetail["members"][number]>(
        db,
        sql`select u.name, u.email, m.role, ${epochMs(sql`m.created_at`)} as "joinedAt", coalesce(u.two_factor_enabled, false) as "twoFactor", u.email_verified as "emailVerified"
            from member m join "user" u on u.id = m.user_id where m.organization_id = ${id} order by m.created_at`,
      ),
      queryRows<{
        id: string;
        name: string;
        authKind: string;
        level: AgentAccessLevel;
        clientName: string | null;
        sharesParentKey: boolean;
        parentAgentId: string | null;
        createdAt: number;
        lastSeenAt: number | null;
        revoked: boolean;
        expired: boolean;
        approvedBy: string | null;
        calls: number;
        errors: number;
      }>(
        db,
        sql`select a.id, a.name, a.auth_kind as "authKind", a.access_level as level, c.name as "clientName", a.shares_parent_key as "sharesParentKey",
              a.parent_agent_id as "parentAgentId", ${epochMs(sql`a.created_at`)} as "createdAt", ${epochMs(sql`a.last_seen_at`)} as "lastSeenAt",
              a.revoked_at is not null as revoked, (a.access_expires_at is not null and a.access_expires_at <= now()) as expired,
              u.name as "approvedBy", coalesce(tc.calls, 0)::int as calls, coalesce(tc.errors, 0)::int as errors
            from agents a
              left join oauth_client c on c.client_id = a.oauth_client_id
              left join "user" u on u.id = a.created_by_user_id
              left join (select agent_id, sum(calls) as calls, sum(errors) as errors from tool_calls_daily
                         where tenant_id = ${id} and day >= ${fromDay}::date group by 1) tc on tc.agent_id = a.id
            where a.tenant_id = ${id} and a.auth_kind <> 'system'
            order by a.revoked_at is not null, coalesce(a.parent_agent_id, a.id), a.parent_agent_id is not null, a.created_at`,
      ),
      queryRows<{ status: TaskStatus; count: number }>(db, sql`select status::text as status, count(*)::int as count from tasks where tenant_id = ${id} group by 1`),
      queryRows<{ day: string; action: string; events: number }>(
        db,
        sql`select u.day, u.action, sum(u.events)::int as events from ${source} as u
            where u.tenant_id = ${id} and u.day >= ${fromDay} and u.action <> 'task.done' group by 1, 2`,
      ),
      // Who did each action over the whole window, counted once however many days they did it.
      queryRows<{ action: string; actors: number }>(
        db,
        sql`select u.action, count(distinct (u.actor_type, u.actor_id))::int as actors from ${source} as u
            where u.tenant_id = ${id} and u.day >= ${fromDay} and u.action <> 'task.done' group by 1`,
      ),
      queryRows<{ open: number; oldest: number | null }>(
        db,
        sql`select count(*)::int as open, ${epochMs(sql`min((input_request->>'askedAt')::timestamptz)`)} as oldest
            from tasks where tenant_id = ${id} and input_request is not null`,
      ),
      answerDurations(db, from, id),
      queryRows<{ id: string; name: string; kind: string; status: string; runs: Record<string, number> | null; lastRunAt: number | null }>(
        db,
        sql`select p.id, p.name, p.kind::text as kind, p.status::text as status,
              (select jsonb_object_agg(s.status, s.n) from (select r.status::text as status, count(*)::int as n from pipeline_runs r
                 where r.tenant_id = p.tenant_id and r.pipeline_id = p.id group by 1) s) as runs,
              (select ${epochMs(sql`max(r.started_at)`)} from pipeline_runs r where r.tenant_id = p.tenant_id and r.pipeline_id = p.id) as "lastRunAt"
            from pipelines p where p.tenant_id = ${id} order by p.created_at`,
      ),
      queryRows<{
        id: string;
        agentName: string;
        url: string;
        status: string;
        topics: string[];
        scope: string;
        failures: number;
        lastSuccessAt: number | null;
        lastFailureAt: number | null;
        lastStatus: number | null;
        deliveries: Record<string, number> | null;
      }>(
        db,
        sql`select w.id, a.name as "agentName", w.url, w.status, w.topics, w.scope, w.consecutive_failures as failures,
              ${epochMs(sql`w.last_success_at`)} as "lastSuccessAt", ${epochMs(sql`w.last_failure_at`)} as "lastFailureAt", w.last_status as "lastStatus",
              (select jsonb_object_agg(d.status, d.n) from (select status, count(*)::int as n from webhook_deliveries
                 where webhook_id = w.id and created_at >= ${from}::timestamptz group by 1) d) as deliveries
            from webhooks w join agents a on a.id = w.agent_id where w.tenant_id = ${id} order by w.created_at`,
      ),
      queryRows<{ devices: number; people: number; mutes: number; deliveries: Record<string, number> | null }>(
        db,
        sql`select (select count(*)::int from push_devices d join member m on m.user_id = d.user_id and m.organization_id = ${id}) as devices,
              (select count(distinct d.user_id)::int from push_devices d join member m on m.user_id = d.user_id and m.organization_id = ${id}) as people,
              (select count(*)::int from push_mutes where tenant_id = ${id}) as mutes,
              (select jsonb_object_agg(s.status, s.n) from (select status, count(*)::int as n from push_deliveries
                 where tenant_id = ${id} and created_at >= ${from}::timestamptz group by 1) s) as deliveries`,
      ),
      queryRows<{ format: string; documents: number; bytes: number }>(
        db,
        sql`select format, count(*)::int as documents, coalesce(sum(size), 0)::float8 as bytes from documents where tenant_id = ${id} group by 1 order by 3 desc`,
      ),
      queryRows<{ memories: number; goals: number }>(
        db,
        sql`select (select count(*)::int from memories where tenant_id = ${id}) as memories, (select count(*)::int from goals where tenant_id = ${id}) as goals`,
      ),
      contentGrant(ctx, id, now),
    ]);

    const days = Array.from({ length: REPORT_DAYS }, (_, index) => isoDate(addDays(dayOf(fromDay), index)));
    const perDay = days.map((day) => activityRows.filter((row) => row.day === day).reduce((sum, row) => sum + Number(row.events), 0));
    const actions = new Map<string, { events: number; actors: number }>();
    for (const row of activityRows) {
      const entry = actions.get(row.action) ?? { events: 0, actors: 0 };
      actions.set(row.action, { ...entry, events: entry.events + Number(row.events) });
    }
    for (const row of actorRows) {
      const entry = actions.get(row.action);
      if (entry) entry.actors = Number(row.actors);
    }
    const actionTotal = (action: string) => actions.get(action)?.events ?? 0;
    const durations = answers.map((answer) => answer.ms);
    const storage = storageRows.map((row) => ({ format: row.format, documents: Number(row.documents), bytes: Number(row.bytes) }));
    const nullable = (value: number | null) => (value === null ? null : Number(value));

    return {
      tenant,
      members: members.map((row) => ({ ...row, joinedAt: Number(row.joinedAt) })),
      agents: agentRows.map((row) => ({
        id: row.id,
        name: row.name,
        authKind: row.authKind,
        level: row.level,
        client: clientFamily(row),
        clientName: row.clientName,
        parentAgentId: row.parentAgentId,
        createdAt: Number(row.createdAt),
        lastSeenAt: nullable(row.lastSeenAt),
        state: row.revoked ? "revoked" : row.expired ? "expired" : "live",
        approvedBy: row.approvedBy,
        calls: Number(row.calls),
        errors: Number(row.errors),
      })),
      tasksByStatus: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)])),
      activity: {
        days,
        perDay,
        byAction: [...actions].map(([action, value]) => ({ action, ...value })).sort((a, b) => b.events - a.events),
      },
      decisions: {
        open: Number(decisionRow[0]?.open ?? 0),
        oldestOpenAt: nullable(decisionRow[0]?.oldest ?? null),
        asked: actionTotal("task.input_requested"),
        answered: actionTotal("task.input_answered"),
        medianAnswerMs: median(durations),
        answersTimed: durations.length,
      },
      pipelines: pipelineRows.map((row) => ({ ...row, runs: row.runs ?? {}, lastRunAt: nullable(row.lastRunAt) })),
      webhooks: webhookRows.map((row) => ({
        agentName: row.agentName,
        host: webhookHost(row.url),
        status: row.status,
        topics: row.topics,
        scope: row.scope,
        failures: Number(row.failures),
        lastSuccessAt: nullable(row.lastSuccessAt),
        lastFailureAt: nullable(row.lastFailureAt),
        lastStatus: row.lastStatus,
        deliveries: row.deliveries ?? {},
      })),
      push: {
        devices: Number(pushRow[0]?.devices ?? 0),
        people: Number(pushRow[0]?.people ?? 0),
        mutes: Number(pushRow[0]?.mutes ?? 0),
        deliveries: pushRow[0]?.deliveries ?? {},
      },
      storage: {
        documents: storage.reduce((sum, row) => sum + row.documents, 0),
        bytes: storage.reduce((sum, row) => sum + row.bytes, 0),
        byFormat: storage,
      },
      memories: Number(counts[0]?.memories ?? 0),
      goals: Number(counts[0]?.goals ?? 0),
      grant,
    };
  },
  { tenantId: (_input, output) => output.tenant.id },
);

// ---------------------------------------------------------------------------------------------- content

export const RevealInput = z.object({
  slug: z.string().trim().min(1).max(100),
  reason: z
    .string()
    .trim()
    .min(CONTENT_REASON_MIN, `Say why you need to see this workspace's content, in at least ${CONTENT_REASON_MIN} characters.`)
    .max(CONTENT_REASON_MAX),
});

/**
 * "Show content": records why this admin needs to read a workspace's content. The audit row it writes
 * is the grant `getWorkspaceContent` checks, for `CONTENT_GRANT_MINUTES`, for this admin and workspace.
 */
export const revealContent = platformService(
  CONTENT_REVEAL,
  RevealInput,
  async (ctx, { slug }) => {
    const tenant = await tenantBySlug(ctx, slug);
    return { tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
  },
  { tenantId: (_input, output) => output.tenant.id, reason: (input) => input.reason },
);

export interface WorkspaceContent {
  tenantId: string;
  until: Date;
  reason: string;
  tasks: { title: string; status: TaskStatus; updatedAt: number }[];
  open: { question: string; kind: string; agentName: string; askedAt: string; options: number }[];
  answered: { question: string; answer: string; outcome: string; agentName: string; closedAt: string }[];
}

/**
 * A workspace's recent content (task titles, open requests, recent answers), only within a grant
 * from `revealContent` by the same admin. Memories and documents are never shown here.
 */
export const getWorkspaceContent = platformService(
  "view.workspace_content",
  SlugInput,
  async (ctx, { slug }): Promise<WorkspaceContent> => {
    const tenant = await tenantBySlug(ctx, slug);
    const grant = await contentGrant(ctx, tenant.id);
    if (!grant) throw forbidden("Show content first, with a reason; it stays open for 30 minutes.");
    const [recent, openRows, answerRows] = await Promise.all([
      ctx.db
        .select({ title: tasks.title, status: tasks.status, updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(eq(tasks.tenantId, tenant.id))
        .orderBy(desc(tasks.updatedAt))
        .limit(20),
      ctx.db
        .select({ request: tasks.inputRequest })
        .from(tasks)
        .where(and(eq(tasks.tenantId, tenant.id), sql`${tasks.inputRequest} is not null`))
        .orderBy(sql`${tasks.inputRequest}->>'askedAt'`)
        .limit(20),
      queryRows<{ question: string; answer: string; outcome: string; agentName: string; closedAt: string }>(
        ctx.db,
        sql`select a->>'question' as question, coalesce(a->>'answer', '') as answer, a->>'outcome' as outcome, a->>'agentName' as "agentName", a->>'closedAt' as "closedAt"
            from tasks t cross join lateral jsonb_array_elements(t.input_answers) as a
            where t.tenant_id = ${tenant.id} and t.input_answers <> '[]'::jsonb
            order by (a->>'closedAt')::timestamptz desc limit 20`,
      ),
    ]);
    return {
      tenantId: tenant.id,
      until: grant.until,
      reason: grant.reason,
      tasks: recent.map((row) => ({ title: row.title, status: row.status, updatedAt: row.updatedAt.getTime() })),
      open: openRows.flatMap(({ request }) =>
        request ? [{ question: request.question, kind: request.kind, agentName: request.agentName, askedAt: request.askedAt, options: request.options.length }] : [],
      ),
      answered: answerRows,
    };
  },
  { tenantId: (_input, output) => output.tenantId },
);

