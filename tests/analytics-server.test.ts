import { randomUUID } from "node:crypto";

import type { Client } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EVENTS, type EventName } from "@/lib/analytics";
import { isoDayFromToday } from "@/lib/dates";
import type { Source } from "@/lib/domain";
import { PIPELINE_TEMPLATE_META } from "@/lib/pipeline-templates";
import { ANALYTICS_BURST, ANALYTICS_PER_MINUTE, analyticsHash, durationBucket, sendServerEvents, setAnalyticsSender, takeAnalyticsToken } from "@/server/analytics";
import { agents, oauthClient } from "@/server/db/schema";
import { approveAgentThen, noteToolCall } from "@/server/domain/agents";
import { templateOf } from "@/server/domain/analytics";
import { inTransaction, type Ctx } from "@/server/domain/context";
import { cancelRun, definePipeline, getRun, startRun } from "@/server/domain/pipelines";
import { captureTasks, completeTask, handOffTask, requestInput } from "@/server/domain/tasks";
import { createPheanMcpHandler } from "@/server/mcp/handler";

import { addMember, asUser, createTestDb, seedUser, seedWorkspace, type TestDb, type TestUser, type Workspace } from "./support/db";
import { connectMcpClient, dataOf } from "./support/mcp";

interface SentEvent {
  name: EventName;
  params: Record<string, unknown>;
  userId?: string;
  clientId: string;
}

let testDb: TestDb;
let ws: Workspace;
let lee: TestUser;
let sent: SentEvent[];
let bodies: string[];

const SALT = "test-salt";

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  vi.stubEnv("ANALYTICS_ID_SALT", SALT);
  sent = [];
  bodies = [];
  setAnalyticsSender((body) => {
    const { events, user_id, client_id } = body as { events: { name: EventName; params: Record<string, unknown> }[]; user_id?: string; client_id: string };
    bodies.push(JSON.stringify(body));
    for (const event of events) sent.push({ name: event.name, params: event.params, userId: user_id, clientId: client_id });
    return Promise.resolve();
  });
  ws = await seedWorkspace(testDb.db);
  lee = await seedUser(testDb.db, "Lee");
  await addMember(testDb.db, ws.tenant, lee, "member");
});

afterEach(() => {
  setAnalyticsSender(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const named = (name: EventName) => sent.filter((event) => event.name === name);
const dana = () => ws.human.actor.id;
const COMMON = ["surface", "source_side", "engagement_time_msec", "workspace_hash"];

/** Every body carries only its catalog's params and the common ones, and none of the ids or words Phean holds. */
function expectClean(...secrets: string[]): void {
  for (const event of sent) {
    const allowed = new Set([...Object.keys(EVENTS[event.name].params), ...COMMON]);
    for (const key of Object.keys(event.params)) expect(allowed, `${event.name}.${key}`).toContain(key);
    expect(event.params.workspace_hash).toBe(analyticsHash("workspace", ws.tenant.id));
    expect(event.params.source_side).toBe("server");
  }
  for (const body of bodies) for (const secret of [ws.tenant.id, ws.tenant.slug, dana(), ws.scout.agentId, ...secrets]) expect(body).not.toContain(secret);
}

describe("the flood limit and buckets", () => {
  it("lets a burst through, then refills by the minute", () => {
    const key = `test:${randomUUID()}`;
    const start = 1_000_000;
    for (let i = 0; i < ANALYTICS_BURST; i++) expect(takeAnalyticsToken(key, start)).toBe(true);
    expect(takeAnalyticsToken(key, start)).toBe(false);
    expect(takeAnalyticsToken(key, start + 60_000 / ANALYTICS_PER_MINUTE)).toBe(true);
    expect(takeAnalyticsToken(key, start + 60_000 / ANALYTICS_PER_MINUTE)).toBe(false);
    // Another workspace has its own bucket.
    expect(takeAnalyticsToken(`test:${randomUUID()}`, start)).toBe(true);
  });

  it("drops a workspace's events past the limit in sendServerEvents", () => {
    for (let i = 0; i < ANALYTICS_BURST + 10; i++) sendServerEvents({ name: "hand_off", params: { to: "agent" }, tenantId: ws.tenant.id });
    expect(named("hand_off")).toHaveLength(ANALYTICS_BURST);
  });

  it("buckets durations", () => {
    expect([30_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 10 * 3_600_000, 3 * 86_400_000, 9 * 86_400_000].map(durationBucket)).toEqual(["<1m", "1-10m", "10-60m", "1-6h", "6-24h", "1-7d", "7d+"]);
  });

  it("sends nothing without the salt, since there is no id to send it under", () => {
    vi.stubEnv("ANALYTICS_ID_SALT", "");
    sendServerEvents({ name: "hand_off", params: { to: "agent" }, tenantId: ws.tenant.id });
    expect(sent).toEqual([]);
  });
});

describe("agent approval", () => {
  const clientId = () => `client_${randomUUID()}`;

  async function registeredClient(name: string): Promise<string> {
    const id = clientId();
    await testDb.db.insert(oauthClient).values({ id: randomUUID(), clientId: id, name, redirectUris: ["http://127.0.0.1/callback"] });
    return id;
  }

  it("sends agent_connect_approve after the code is issued, with the client as a hint and the approver hashed", async () => {
    const oauthClientId = await registeredClient("Claude Code (my-laptop)");
    await approveAgentThen(ws.human, { name: "Laptop", level: "write", lifetimeDays: 30, oauthClientId }, () => Promise.resolve(), { tookOverWork: true });
    expect(named("agent_connect_approve")).toEqual([
      expect.objectContaining({
        userId: analyticsHash("user", dana()),
        params: expect.objectContaining({ level: "write", lifetime_days: 30, reconnect: false, took_over_work: true, client_hint: "claude_code" }),
      }),
    ]);

    await approveAgentThen(ws.human, { name: "Laptop", level: "read", lifetimeDays: 7, oauthClientId }, () => Promise.resolve());
    expect(named("agent_connect_approve")[1]!.params).toMatchObject({ level: "read", lifetime_days: 7, reconnect: true, took_over_work: false });
    expectClean("Laptop", "my-laptop", oauthClientId);
  });

  it("sends nothing when issuing the code fails", async () => {
    const oauthClientId = await registeredClient("Cursor");
    await expect(approveAgentThen(ws.human, { name: "Desk", level: "write", lifetimeDays: 30, oauthClientId }, () => Promise.reject(new Error("no code")))).rejects.toThrow("no code");
    expect(named("agent_connect_approve")).toEqual([]);
  });
});

describe("agent activity over MCP", () => {
  let oauthClientId: string;
  let agentId: string;
  let client: Client;

  beforeEach(async () => {
    oauthClientId = `client_${randomUUID()}`;
    await testDb.db.insert(oauthClient).values({ id: randomUUID(), clientId: oauthClientId, name: "Cursor", redirectUris: ["http://127.0.0.1/callback"] });
    const leeCtx = asUser(testDb.db, ws.tenant, lee, "member");
    ({ agent: { id: agentId } } = await approveAgentThen(leeCtx, { name: "Lee's Cursor", level: "write", lifetimeDays: 30, oauthClientId }, () => Promise.resolve()));
    const now = Math.floor(Date.now() / 1000);
    const handler = createPheanMcpHandler({ getDb: () => testDb.db, verifyOAuthToken: () => Promise.resolve({ agentId, clientId: oauthClientId, issuedAt: now, expiresAt: now + 3600 }) });
    client = await connectMcpClient(handler, "oauth-access-token");
    sent = [];
    bodies = [];
  });

  afterEach(() => client.close());

  it("sends agent_first_call once, and agent_active_day once a UTC day, under the approver", async () => {
    dataOf(await client.callTool({ name: "whoami", arguments: {} }));
    dataOf(await client.callTool({ name: "list_tasks", arguments: {} }));
    expect(sent.map((event) => event.name)).toEqual(["agent_first_call", "agent_active_day"]);
    expect(named("agent_first_call")[0]).toMatchObject({ userId: analyticsHash("user", lee.id), params: { client_hint: "cursor", level: "write" } });
    const [row] = await testDb.db.select({ day: agents.lastActiveDay }).from(agents).where(eq(agents.id, agentId));
    expect(row!.day).toBe(isoDayFromToday(0));

    // The next UTC day it is active again, but its first call is behind it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 86_400_000));
    dataOf(await client.callTool({ name: "whoami", arguments: {} }));
    vi.useRealTimers();
    expect(sent.map((event) => event.name)).toEqual(["agent_first_call", "agent_active_day", "agent_active_day"]);
    expectClean(agentId, lee.id, "Lee's Cursor", oauthClientId);
  });

  it("decides each day once however many calls race, in this process or another", async () => {
    const [scoutRow] = await testDb.db.select({ day: agents.lastActiveDay }).from(agents).where(eq(agents.id, ws.scout.agentId));
    expect(scoutRow!.day).toBeNull();
    await Promise.all([noteToolCall(ws.scout.ctx), noteToolCall(ws.scout.ctx), noteToolCall(ws.scout.ctx)]);
    // Another server, which has not seen today yet, finds the day taken.
    await testDb.db.update(agents).set({ lastActiveDay: isoDayFromToday(-1) }).where(eq(agents.id, ws.closer.agentId));
    await noteToolCall(ws.closer.ctx);
    await noteToolCall(ws.closer.ctx);
    // A key is issued, not approved: it is active, but has no first call.
    expect(sent.map((event) => event.name)).toEqual(["agent_active_day", "agent_active_day"]);
    expect(sent[0]!.userId).toBe(analyticsHash("user", dana()));
  });
});

describe("what agents do", () => {
  let scout: Ctx;

  beforeEach(() => {
    scout = ws.scout.ctx;
  });

  it("task_capture counts what was created, per source, and not a person's quick add", async () => {
    const draft = (n: number, source: Source) => ({ title: `Secret title ${n}`, source, sourceRef: `ref-${n}` });
    await captureTasks(scout, { tasks: [draft(1, "email"), draft(2, "email"), draft(3, "email"), draft(4, "slack")] });
    // A re-capture creates nothing.
    await captureTasks(scout, { tasks: [draft(1, "email")] });
    await captureTasks(ws.human, { tasks: [draft(5, "manual")] });
    expect(named("task_capture").map((event) => event.params)).toEqual([
      expect.objectContaining({ count_bucket: "2-3", source: "email" }),
      expect.objectContaining({ count_bucket: "1", source: "slack" }),
    ]);
    expect(named("task_capture")[0]!.userId).toBe(analyticsHash("user", dana()));
    expectClean("Secret title", "ref-1");
  });

  it("sends nothing when the transaction rolls back", async () => {
    await expect(
      inTransaction(scout, async (tx) => {
        await captureTasks(tx, { tasks: [{ title: "Rolled back", source: "chat", sourceRef: "rb" }] });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(sent).toEqual([]);
  });

  it("sends nothing for a savepoint a caller caught and rolled back, and what committed around it", async () => {
    await inTransaction(scout, async (tx) => {
      await inTransaction(tx, async (inner) => {
        await captureTasks(inner, { tasks: [{ title: "Rolled back", source: "chat", sourceRef: "sp-1" }] });
        throw new Error("abort");
      }).catch(() => undefined);
      await captureTasks(tx, { tasks: [{ title: "Kept", source: "email", sourceRef: "sp-2" }] });
    });
    expect(named("task_capture").map((event) => event.params.source)).toEqual(["email"]);
  });

  it("decision_ask and hand_off say what kind, never what was asked or of whom", async () => {
    const { created } = await captureTasks(scout, { tasks: [{ title: "Pick a vendor", source: "chat", sourceRef: "v1" }] });
    const taskId = created[0]!.id;
    await requestInput(scout, { taskId, kind: "decision", question: "Which vendor, Acme or Globex?", options: ["Acme", "Globex"] });
    await requestInput(scout, { taskId, kind: "question", question: "Budget?" });
    expect(named("decision_ask").map((event) => event.params)).toEqual([
      expect.objectContaining({ kind: "decision", with_options: true, is_pipeline: false }),
      expect.objectContaining({ kind: "question", with_options: false, is_pipeline: false }),
    ]);

    await handOffTask(scout, { taskId, toAgent: "Closer" });
    await handOffTask(scout, { taskId, toPerson: lee.email });
    await handOffTask(scout, { taskId });
    // A person's handoff is counted on the page.
    await handOffTask(ws.human, { taskId, toAgent: "Closer" });
    expect(named("hand_off").map((event) => event.params.to)).toEqual(["agent", "person", "anyone"]);
    expectClean(taskId, "Pick a vendor", "Which vendor", "Acme", lee.email);
  });

  it("a refused request sends nothing", async () => {
    const { created } = await captureTasks(scout, { tasks: [{ title: "Done already", source: "chat", sourceRef: "d1" }] });
    await completeTask(scout, { taskId: created[0]!.id, note: "" });
    sent = [];
    await expect(requestInput(scout, { taskId: created[0]!.id, kind: "question", question: "Too late?" })).rejects.toMatchObject({ code: "conflict" });
    expect(sent).toEqual([]);
  });
});

describe("pipelines", () => {
  const oneStop = (agent: string) => ({ stops: [{ id: "work", name: "Work", kind: "agent", agent, then: { end: "done" } }], ends: [{ id: "done", name: "Done" }], inputs: [] }) as never;

  it("pipeline_create names its template and shape, and who made it", async () => {
    const { definition } = PIPELINE_TEMPLATE_META.research_send;
    await definePipeline(ws.human, { name: "Secret newsletter", definition: definition as never });
    await definePipeline(ws.scout.ctx, { name: "Agent's own", definition: oneStop("Closer") });
    expect(named("pipeline_create").map((event) => event.params)).toEqual([
      expect.objectContaining({ kind: "regular", template: "research_send", stops_count: 4, has_person_stop: true, has_fork: false, has_choice: true, created_by: "person" }),
      expect.objectContaining({ kind: "regular", template: "blank", stops_count: 1, has_person_stop: false, has_fork: false, has_choice: false, created_by: "agent" }),
    ]);
    expect(named("pipeline_create")[1]!.userId).toBe(analyticsHash("user", dana()));
    expectClean("Secret newsletter", "Closer");
  });

  it("recognises a template whose stops were given to named agents and people", () => {
    const { definition } = PIPELINE_TEMPLATE_META.triage_verify;
    const edited = { ...definition, stops: definition.stops.map((stop) => (stop.kind === "person" ? { ...stop, person: "lee@example.com" } : { ...stop, kind: "agent" as const, agent: "Scout", instructions: "Other words" })) };
    expect(templateOf(edited)).toBe("triage_verify");
    expect(templateOf({ ...edited, ends: [...edited.ends, { id: "extra", name: "Extra" }] })).toBe("blank");
  });

  it("run_start says how a run started, and run_end how it ended and roughly how long it took", async () => {
    const { pipeline } = await definePipeline(ws.human, { name: "Weekly", definition: oneStop("Scout") });
    const manual = await startRun(ws.human, { pipelineId: pipeline.id });
    const byAgent = await startRun(ws.scout.ctx, { pipelineId: pipeline.id });
    expect(named("run_start").map((event) => event.params.trigger)).toEqual(["manual", "agent"]);

    const stopTask = manual.stops.find((stop) => stop.stopId === "work")!.task!.id;
    await completeTask(ws.scout.ctx, { taskId: stopTask, note: "Done" });
    expect((await getRun(ws.human, { runId: manual.run.id })).run.status).toBe("done");
    await cancelRun(ws.human, { runId: byAgent.run.id, reason: "Not this week" });
    expect(named("run_end").map((event) => event.params)).toEqual([
      expect.objectContaining({ outcome: "done", duration_bucket: "<1m" }),
      expect.objectContaining({ outcome: "cancelled", duration_bucket: "<1m" }),
    ]);
    expectClean("Weekly", manual.run.id, "Not this week");
  });

  it("a person stop's decision is a pipeline's decision_ask", async () => {
    await definePipeline(ws.human, {
      name: "Approval",
      kind: "adhoc",
      definition: { stops: [{ id: "ok", name: "OK?", kind: "person", person: lee.email, options: ["Yes", "No"], then: { end: "done" } }], ends: [{ id: "done", name: "Done" }], inputs: [] } as never,
    });
    expect(named("run_start").map((event) => event.params.trigger)).toEqual(["manual"]);
    expect(named("decision_ask")).toEqual([expect.objectContaining({ userId: undefined, params: expect.objectContaining({ kind: "decision", with_options: true, is_pipeline: true }) })]);
  });
});
