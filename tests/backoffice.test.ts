import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { todayIso } from "@/lib/dates";
import { agents, backofficeAudit, events } from "@/server/db/schema";
import { queryRows } from "@/server/db/raw";
import {
  exportWorkspaces,
  getActivation,
  getAgentsReport,
  getOverview,
  getProductUsage,
  getSystemHealth,
  getWorkspaceContent,
  getWorkspaceDetail,
  listAuditLog,
  listWorkspaces,
  revealContent,
  searchPeople,
} from "@/server/backoffice";
import type { PlatformCtx } from "@/server/backoffice/context";
import { BACKOFFICE_INDEXES, ensureBackofficeIndexes } from "@/server/backoffice/indexes";
import { rollUpUsage, usageSource } from "@/server/backoffice/rollup";
import { webhookHost } from "@/server/backoffice/workspaces";
import { definePipeline, startRun } from "@/server/domain/pipelines";
import { countToolCall } from "@/server/domain/usage";
import { answerInput, captureTasks, claimTask, completeTask, handOffTask, requestInput } from "@/server/domain/tasks";

import { ADMIN_EMAIL, seedPlatformAdmin } from "./support/backoffice";
import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";

let testDb: TestDb;
let admin: PlatformCtx;
let acme: Workspace;
let globex: Workspace;
let initech: Workspace;

/** Some work in a workspace: two captured tasks, one completed, a decision asked and answered, a handoff. */
async function work(workspace: Workspace, title: string) {
  const { created } = await captureTasks(workspace.scout.ctx, {
    tasks: [
      { title, status: "todo" },
      { title: `${title} follow-up`, status: "todo" },
    ],
  });
  const [first, second] = created;
  await claimTask(workspace.scout.ctx, { taskId: first!.id });
  await requestInput(workspace.scout.ctx, { taskId: first!.id, question: `Ship ${title}?`, kind: "decision", options: ["Yes", "No"] });
  await answerInput(workspace.human, { taskId: first!.id, answer: "Yes" });
  await completeTask(workspace.scout.ctx, { taskId: first!.id });
  await handOffTask(workspace.scout.ctx, { taskId: second!.id, toAgent: "Closer" });
  return { first: first!, second: second! };
}

beforeEach(async () => {
  // A fresh database per test: these reports read every workspace on purpose.
  testDb = await createTestDb();
  vi.stubEnv("PHEAN_PLATFORM_ADMINS", ADMIN_EMAIL);
  vi.stubEnv("PHEAN_ADMIN_REQUIRE_2FA", "0");
  admin = await seedPlatformAdmin(testDb.db);
  [acme, globex, initech] = await Promise.all([
    seedWorkspace(testDb.db),
    seedWorkspace(testDb.db, { name: "Globex", owner: "Eli" }),
    seedWorkspace(testDb.db, { name: "Initech", owner: "Bill" }),
  ]);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

describe("backoffice overview", () => {
  it("adds up every workspace's activity this week", async () => {
    await work(acme, "Renew the lease");
    await work(globex, "Hire a designer");

    const overview = await getOverview(admin, {});
    const last = (values: readonly (number | null)[]) => values.at(-1);
    expect(overview.windows).toHaveLength(12);
    expect(overview.windows.at(-1)!.to).toBe(todayIso());
    // Three owners and the admin; six agents.
    expect(overview.totals).toEqual({ workspaces: 3, people: 4, agents: 6 });
    expect(last(overview.trends.signups)).toBe(4);
    expect(last(overview.trends.workspaces)).toBe(3);
    // Each owner connected two agents this week, which is activity; the admin did nothing.
    expect(last(overview.trends.activeWorkspaces)).toBe(3);
    expect(last(overview.trends.activePeople)).toBe(3);
    // Only Acme's and Globex's Scouts acted themselves.
    expect(last(overview.trends.activeAgents)).toBe(2);
    expect(last(overview.trends.decisionsAsked)).toBe(2);
    expect(last(overview.trends.decisionsAnswered)).toBe(2);
    expect(last(overview.trends.answersTimed)).toBe(2);
    expect(last(overview.trends.medianAnswerMs)).toBeGreaterThanOrEqual(0);
    expect(last(overview.trends.tasksCaptured)).toBe(4);
    expect(last(overview.trends.tasksDone)).toBe(2);
    expect(last(overview.trends.handoffs)).toBe(2);
    // Earlier windows are empty, not missing.
    expect(overview.trends.decisionsAsked.slice(0, 11)).toEqual(Array(11).fill(0));
  });

  it("counts an agent active when it only called tools", async () => {
    await countToolCall(initech.scout.ctx, "list_tasks", false);
    const overview = await getOverview(admin, {});
    expect(overview.trends.activeAgents.at(-1)).toBe(1);
  });
});

describe("usage rollup", () => {
  it("stores whole days and reads the same totals as the live log", async () => {
    await work(acme, "Renew the lease");
    // Backdate some of the log into earlier days, as history.
    await testDb.db.execute(sql`update events set created_at = created_at - interval '3 days' where action = 'task.captured'`);
    const live = await getOverview(admin, {});

    const report = await rollUpUsage(testDb.db);
    expect(report.rows).toBeGreaterThan(0);
    const stored = await queryRows<{ action: string; events: number }>(testDb.db, sql`select action, sum(events)::int as events from usage_daily group by 1`);
    expect(stored.find((row) => row.action === "task.captured")?.events).toBe(2);

    const rolled = await getOverview(admin, {});
    expect(rolled.trends).toEqual(live.trends);

    // Running it again changes nothing.
    await rollUpUsage(testDb.db);
    const again = await queryRows<{ events: number }>(testDb.db, sql`select sum(events)::int as events from usage_daily`);
    expect(Number(again[0]!.events)).toBe(stored.reduce((sum, row) => sum + Number(row.events), 0));
  });

  it("never stores today, and counts the pipelines agent as system, never as an active agent", async () => {
    // A real run: the pipelines agent captures the stop's task and hands it to Scout.
    const { pipeline } = await definePipeline(acme.human, {
      name: "Newsletter",
      definition: { stops: [{ id: "research", name: "Research", kind: "agent", agent: "Scout", then: { end: "done" } }], ends: [{ id: "done", name: "Done" }], inputs: [] } as never,
    });
    await startRun(acme.human, { pipelineId: pipeline.id });
    // Only the person who started it, and the pipelines agent, acted; Scout and Closer did nothing themselves.
    await testDb.db.execute(sql`delete from events where action = 'agent.created'`);

    await rollUpUsage(testDb.db);
    const stored = await queryRows<{ count: number }>(testDb.db, sql`select count(*)::int as count from usage_daily where day = ${todayIso()}::date`);
    expect(Number(stored[0]!.count)).toBe(0);
    const source = await usageSource(testDb.db, todayIso());
    const kinds = await queryRows<{ actor_type: string }>(testDb.db, sql`select distinct actor_type from ${source} as u where u.tenant_id = ${acme.tenant.id}`);
    expect(kinds.map((row) => row.actor_type).sort()).toEqual(["system", "user"]);

    const overview = await getOverview(admin, {});
    expect(overview.trends.activeAgents.at(-1)).toBe(0);
    expect(overview.trends.activePeople.at(-1)).toBe(1);
  });
});

describe("rollup under load and lag", () => {
  it("lets two rollups run at once without colliding, and ends with one copy of each day", async () => {
    await work(acme, "Renew the lease");
    await testDb.db.execute(sql`update events set created_at = created_at - interval '2 days'`);
    const reports = await Promise.all([rollUpUsage(testDb.db), rollUpUsage(testDb.db), rollUpUsage(testDb.db)]);
    expect(reports.every((report) => report.through === reports[0]!.through)).toBe(true);
    const [row] = await queryRows<{ captured: number }>(testDb.db, sql`select sum(events)::int as captured from usage_daily where action = 'task.captured'`);
    expect(Number(row!.captured)).toBe(2);
  });

  it("reads the days a stalled cron never stored from the live log", async () => {
    await work(acme, "Renew the lease");
    // The cron last finished five days ago; since then, work happened three days ago and today.
    await rollUpUsage(testDb.db, new Date(Date.now() - 5 * 86_400_000));
    await work(globex, "Hire a designer");
    await testDb.db.execute(sql`update events set created_at = created_at - interval '3 days' where tenant_id = ${globex.tenant.id}`);
    await work(initech, "Order chairs");
    const overview = await getOverview(admin, {});
    expect(overview.trends.decisionsAsked.at(-1)).toBe(3);
    expect(overview.trends.tasksCaptured.at(-1)).toBe(6);
  });

  it("recomputes every day with full, for backdated history", async () => {
    await rollUpUsage(testDb.db);
    await work(acme, "Renew the lease");
    await testDb.db.execute(sql`update events set created_at = created_at - interval '10 days'`);
    const quick = await rollUpUsage(testDb.db);
    expect(quick.from).toBe(quick.through);
    const full = await rollUpUsage(testDb.db, new Date(), { full: true });
    expect(full.from < quick.from).toBe(true);
    const [row] = await queryRows<{ asked: number }>(testDb.db, sql`select sum(events)::int as asked from usage_daily where action = 'task.input_requested'`);
    expect(Number(row!.asked)).toBe(1);
  });

  it("builds its indexes concurrently, once, and rebuilds one left invalid", async () => {
    expect(await ensureBackofficeIndexes(testDb.db)).toEqual(BACKOFFICE_INDEXES.map((index) => index.name));
    expect(await ensureBackofficeIndexes(testDb.db)).toEqual([]);
    await testDb.db.execute(sql`update pg_index set indisvalid = false where indexrelid = 'events_created_idx'::regclass`);
    expect(await ensureBackofficeIndexes(testDb.db)).toEqual(["events_created_idx"]);
  });
});

describe("activation", () => {
  it("walks this cohort from signup to an answered decision", async () => {
    await work(acme, "Renew the lease");
    const activation = await getActivation(admin, {});
    const step = (key: string) => activation.steps.find((candidate) => candidate.key === key)!;
    // Four signups (three owners and the admin), three of whom created a workspace and connected agents.
    expect(step("signed_up").count).toBe(4);
    expect(step("workspace").count).toBe(3);
    expect(step("agent").count).toBe(3);
    expect(step("asked").count).toBe(1);
    expect(step("answered").count).toBe(1);
    expect(step("answered").fromStart).toBeCloseTo(0.25);
    // Nobody signed up two weeks ago yet.
    expect(step("week2").eligible).toBe(0);
    expect(activation.retention).toHaveLength(12);
    expect(activation.retention.at(-1)!.size).toBe(4);
  });

  it("compares a signup (stored as UTC, without a zone) with event times whatever the session's time zone", async () => {
    await work(acme, "Renew the lease");
    await testDb.db.execute(sql`set time zone 'America/New_York'`);
    try {
      const activation = await getActivation(admin, {});
      expect(activation.steps.find((step) => step.key === "asked")!.count).toBe(1);
    } finally {
      await testDb.db.execute(sql`set time zone 'UTC'`);
    }
  });
});

describe("workspaces table", () => {
  it("lists every workspace with its figures, sorted and searchable", async () => {
    await work(acme, "Renew the lease");
    await work(acme, "Order chairs");
    await countToolCall(acme.scout.ctx, "capture_tasks", false);

    const all = await listWorkspaces(admin, { sort: "open_tasks" });
    expect(all.total).toBe(3);
    const [top] = all.rows;
    expect(top).toMatchObject({ slug: acme.tenant.slug, members: 1, agents: 2, openTasks: 2, doneTasks: 2, answered: 2, flags: [] });
    expect(top!.agentsByLevel).toEqual({ read: 0, write: 2, admin: 0 });
    expect(top!.clients).toEqual(["Fixed key"]);
    expect(top!.ownerEmail).toMatch(/^dana\./);
    expect(top!.lastActivityAt).not.toBeNull();

    const byName = await listWorkspaces(admin, { sort: "name", dir: "asc" });
    expect(byName.rows.map((row) => row.name)).toEqual(["Acme", "Globex", "Initech"]);

    const found = await listWorkspaces(admin, { q: "glob" });
    expect(found.rows.map((row) => row.slug)).toEqual([globex.tenant.slug]);
    // Search words are text, never a pattern.
    expect((await listWorkspaces(admin, { q: "%" })).total).toBe(0);
  });

  it("filters by health", async () => {
    const { second } = await work(acme, "Renew the lease");
    await requestInput(acme.scout.ctx, { taskId: second.id, question: "Which day?" });
    await testDb.db.execute(sql`update tasks set input_request = jsonb_set(input_request, '{askedAt}', to_jsonb((now() - interval '5 days')::text)) where input_request is not null`);
    const stuck = await listWorkspaces(admin, { health: "stuck_decisions" });
    expect(stuck.rows.map((row) => row.slug)).toEqual([acme.tenant.slug]);
    expect(stuck.rows[0]!.flags).toContain("stuck_decisions");
  });

  it("exports the same rows, and records the export", async () => {
    const exported = await exportWorkspaces(admin, { sort: "name", dir: "asc" });
    expect(exported.rows.map((row) => row.name)).toEqual(["Acme", "Globex", "Initech"]);
    const [entry] = await testDb.db.select().from(backofficeAudit).where(sql`${backofficeAudit.action} = 'export.workspaces'`);
    expect(entry).toMatchObject({ adminEmail: ADMIN_EMAIL, filters: { sort: "name", dir: "asc" } });
  });
});

describe("workspace detail and content", () => {
  it("shows metadata without content", async () => {
    await work(acme, "Renew the lease");
    await countToolCall(acme.scout.ctx, "capture_tasks", true);
    const detail = await getWorkspaceDetail(admin, { slug: acme.tenant.slug });
    expect(detail.tenant.id).toBe(acme.tenant.id);
    expect(detail.members).toHaveLength(1);
    expect(detail.agents.map((agent) => agent.name).sort()).toEqual(["Closer", "Scout"]);
    expect(detail.agents.find((agent) => agent.name === "Scout")).toMatchObject({ calls: 1, errors: 1, client: "Fixed key", state: "live" });
    expect(detail.decisions).toMatchObject({ open: 0, asked: 1, answered: 1, answersTimed: 1 });
    expect(detail.activity.days).toHaveLength(28);
    expect(detail.activity.perDay.at(-1)).toBeGreaterThan(0);
    expect(detail.grant).toBeNull();
    // No titles anywhere in what the page gets.
    expect(JSON.stringify(detail)).not.toContain("Renew the lease");
    await expect(getWorkspaceDetail(admin, { slug: "nowhere" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("shows content only after a reason, for that admin and workspace", async () => {
    await work(acme, "Renew the lease");
    await expect(getWorkspaceContent(admin, { slug: acme.tenant.slug })).rejects.toMatchObject({ code: "forbidden" });
    await expect(revealContent(admin, { slug: acme.tenant.slug, reason: "short" })).rejects.toMatchObject({ code: "invalid" });

    await revealContent(admin, { slug: acme.tenant.slug, reason: "Support ticket 4411: agent loops" });
    const content = await getWorkspaceContent(admin, { slug: acme.tenant.slug });
    expect(content.tasks.map((task) => task.title)).toContain("Renew the lease");
    expect(content.answered[0]).toMatchObject({ question: "Ship Renew the lease?", answer: "Yes", outcome: "answered" });
    expect(content.reason).toBe("Support ticket 4411: agent loops");

    // Another workspace stays closed, and so does this one for another admin.
    await expect(getWorkspaceContent(admin, { slug: globex.tenant.slug })).rejects.toMatchObject({ code: "forbidden" });
    vi.stubEnv("PHEAN_PLATFORM_ADMINS", `${ADMIN_EMAIL},second@phean.example`);
    const second = await seedPlatformAdmin(testDb.db, { email: "second@phean.example" });
    await expect(getWorkspaceContent(second, { slug: acme.tenant.slug })).rejects.toMatchObject({ code: "forbidden" });

    // The grant lapses after 30 minutes.
    await testDb.db.execute(sql`update backoffice_audit set at = now() - interval '31 minutes' where action = 'content.reveal'`);
    await expect(getWorkspaceContent(admin, { slug: acme.tenant.slug })).rejects.toMatchObject({ code: "forbidden" });

    const reveal = (await testDb.db.select().from(backofficeAudit)).find((row) => row.action === "content.reveal");
    expect(reveal).toMatchObject({ tenantId: acme.tenant.id, reason: "Support ticket 4411: agent loops", adminUserId: admin.admin.id });
  });

  it("shows a webhook's host, never its path or query", () => {
    expect(webhookHost("https://hooks.example.com/services/T000/B000/XXXX?token=abc")).toBe("hooks.example.com");
    expect(webhookHost("not a url")).toBe("invalid URL");
  });
});

describe("counting precisely", () => {
  it("counts each action's actors once over the 28 days, not the busiest day's", async () => {
    await captureTasks(acme.scout.ctx, { tasks: [{ title: "Earlier" }] });
    await testDb.db.execute(sql`update events set created_at = created_at - interval '2 days' where action = 'task.captured'`);
    await captureTasks(acme.closer.ctx, { tasks: [{ title: "Today" }] });
    const detail = await getWorkspaceDetail(admin, { slug: acme.tenant.slug });
    expect(detail.activity.byAction.find((row) => row.action === "task.captured")).toEqual({ action: "task.captured", events: 2, actors: 2 });
  });

  it("times answers given in the last 28 days only", async () => {
    await work(acme, "Renew the lease");
    // The answer was given 40 days ago: out of the window, in the list and on the page alike.
    await testDb.db.execute(sql`
      update tasks set updated_at = now() - interval '40 days',
        input_answers = jsonb_set(jsonb_set(input_answers, '{0,closedAt}', to_jsonb((now() - interval '40 days')::text)), '{0,askedAt}', to_jsonb((now() - interval '41 days')::text))
      where input_answers <> '[]'::jsonb`);
    const [row] = (await listWorkspaces(admin, { q: acme.tenant.slug })).rows;
    expect(row).toMatchObject({ answered: 0, medianAnswerMs: null });
    expect((await getWorkspaceDetail(admin, { slug: acme.tenant.slug })).decisions).toMatchObject({ answersTimed: 0, medianAnswerMs: null });
  });

  it("does not let the pipelines agent's events keep a workspace from being dormant", async () => {
    await testDb.db.execute(sql`update organization set created_at = now() - interval '30 days' where id = ${acme.tenant.id}`);
    await testDb.db.execute(sql`update events set created_at = now() - interval '20 days' where tenant_id = ${acme.tenant.id}`);
    const systemId = "ag_pipelines_test";
    await testDb.db.insert(agents).values({ id: systemId, tenantId: acme.tenant.id, name: "Pipelines", authKind: "system" });
    await testDb.db.insert(events).values({ tenantId: acme.tenant.id, actorType: "agent", actorId: systemId, actorName: "Pipelines", action: "pipeline.run_started", entityType: "pipeline_run", entityId: "r_1", summary: "started" });
    const [row] = (await listWorkspaces(admin, { q: acme.tenant.slug })).rows;
    expect(row!.flags).toContain("dormant");
    expect(row!.lastActivityAt).toBeLessThan(Date.now() - 19 * 86_400_000);
    expect((await listWorkspaces(admin, { health: "dormant" })).rows.map((workspace) => workspace.slug)).toEqual([acme.tenant.slug]);
  });

  it("leaves the synthetic task.done out of the actions table", async () => {
    await work(acme, "Renew the lease");
    const usage = await getProductUsage(admin, {});
    expect(usage.actions.map((row) => row.action)).toContain("task.completed");
    expect(usage.actions.map((row) => row.action)).not.toContain("task.done");
  });
});

describe("people, agents, usage, health and audit", () => {
  it("finds people by email with how they sign in, never secrets", async () => {
    const { people } = await searchPeople(admin, { q: "eli." });
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: "Eli", twoFactor: false, devices: 0, platformAdmin: false });
    expect(people[0]!.workspaces).toEqual([{ slug: globex.tenant.slug, name: "Globex", role: "owner" }]);
    expect(Object.keys(people[0]!).sort()).toEqual(
      ["createdAt", "devices", "email", "emailVerified", "id", "lastSessionAt", "liveSessions", "methods", "name", "platformAdmin", "twoFactor", "workspaces"].sort(),
    );
    const recent = await searchPeople(admin, {});
    expect(recent.people.map((person) => person.email)).toContain(ADMIN_EMAIL);
    expect(recent.people.find((person) => person.email === ADMIN_EMAIL)!.platformAdmin).toBe(true);
  });

  it("breaks agents down by client and counts tool calls", async () => {
    await countToolCall(acme.scout.ctx, "list_tasks", false);
    await countToolCall(acme.scout.ctx, "list_tasks", false);
    await countToolCall(globex.closer.ctx, "list_tasks", true);
    await countToolCall(globex.closer.ctx, "claim_task", false);
    const report = await getAgentsReport(admin, {});
    expect(report.clients).toEqual([expect.objectContaining({ client: "Fixed key", agents: 6, live: 6, workspaces: 3, activeLastWeek: 2 })]);
    expect(report.tools[0]).toEqual({ tool: "list_tasks", calls: 3, errors: 1, agents: 2, workspaces: 2 });
    expect(report.totals).toMatchObject({ agents: 6, calls: 4, errors: 1 });
  });

  it("measures feature adoption across workspaces", async () => {
    await work(acme, "Renew the lease");
    const usage = await getProductUsage(admin, {});
    // Every owner connected agents this week; only Acme decided anything.
    expect(usage.activeWorkspaces).toBe(3);
    expect(usage.features.find((feature) => feature.key === "decisions")).toMatchObject({ workspaces: 1, events: 1 });
    expect(usage.features.find((feature) => feature.key === "handoffs")).toMatchObject({ workspaces: 1, events: 1 });
    expect(usage.features.find((feature) => feature.key === "pipelines")).toMatchObject({ workspaces: 0, events: 0 });
    expect(usage.people).toMatchObject({ total: 4, twoFactor: 0, withDevices: 0 });
  });

  it("reads system health, tables included", async () => {
    const health = await getSystemHealth(admin, {});
    expect(health.webhooks).toMatchObject({ total: 0, pending: 0 });
    expect(health.tables.length).toBeGreaterThan(0);
    expect(health.tables.every((table) => table.bytes >= 0)).toBe(true);
    expect(health.rollup.throughDay).toBeNull();
  });

  it("records every view in the audit log, which lists them newest first", async () => {
    await getOverview(admin, {});
    await listWorkspaces(admin, { q: "acme", sort: "name" });
    await getWorkspaceDetail(admin, { slug: acme.tenant.slug });
    const log = await listAuditLog(admin, {});
    expect(log.rows.map((row) => row.action)).toEqual(["view.workspace", "view.workspaces", "view.overview"]);
    expect(log.rows[1]!.filters).toEqual({ q: "acme", sort: "name", page: 1 });
    expect(log.rows[0]).toMatchObject({ tenantSlug: acme.tenant.slug });
    // Reading the log is itself recorded.
    expect((await listAuditLog(admin, {})).rows[0]!.action).toBe("view.audit");
  });

  it("never logs events' content into the rollup", async () => {
    await work(acme, "Renew the lease");
    await rollUpUsage(testDb.db);
    const rows = await queryRows<Record<string, unknown>>(testDb.db, sql`select * from usage_daily`);
    expect(JSON.stringify(rows)).not.toContain("Renew");
    expect((await testDb.db.select().from(events)).length).toBeGreaterThan(0);
  });
});
