import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent, revokeAgent } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";
import { createPheanMcpHandler } from "@/server/mcp/handler";
import { TOOLS } from "@/server/mcp/tools";

import { asUser, createTestDb, seedTenant, seedUser, type TestDb } from "./support/db";
import { connectMcpClient, dataOf, MCP_URL, TEST_ORIGIN, textOf } from "./support/mcp";

let testDb: TestDb;
let owner: Ctx;
let handler: (request: Request) => Promise<Response>;
let scout: Client;
let closer: Client;
let outsider: Client;

const call = (client: Client, name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args });

beforeAll(async () => {
  testDb = await createTestDb();
  const { db } = testDb;
  handler = createPheanMcpHandler({ getDb: () => db });

  const acme = await seedTenant(db, "acme", "Acme");
  owner = asUser(db, acme, await seedUser(db, "Dana"));
  scout = await connectMcpClient(handler, (await createAgent(owner, { name: "Scout" })).token);
  closer = await connectMcpClient(handler, (await createAgent(owner, { name: "Closer" })).token);

  const globex = await seedTenant(db, "globex", "Globex");
  const globexOwner = asUser(db, globex, await seedUser(db, "Eli"));
  outsider = await connectMcpClient(handler, (await createAgent(globexOwner, { name: "Spy" })).token);
});

afterAll(async () => {
  await Promise.all([scout, closer, outsider].map((client) => client?.close()));
  await testDb.close();
});

describe("MCP authentication", () => {
  const initialize = (headers: Record<string, string> = {}) =>
    handler(
      new Request(MCP_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "0" } },
        }),
      }),
    );

  it("rejects requests without a token, with an unknown token, or with a revoked token", async () => {
    const missing = await initialize();
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toMatch(/^Bearer/);

    expect((await initialize({ authorization: "Bearer phn_not-a-real-token" })).status).toBe(401);

    const { agent, token } = await createAgent(owner, { name: "Temp" });
    expect((await initialize({ authorization: `Bearer ${token}` })).status).toBe(200);
    await revokeAgent(owner, { agentId: agent.id });
    expect((await initialize({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("identifies the agent and workspace from the token alone", async () => {
    const me = dataOf(await call(scout, "whoami"));
    expect(me).toMatchObject({
      agent: { name: "Scout" },
      workspace: { slug: "acme" },
      dashboardUrl: `${TEST_ORIGIN}/w/acme`,
    });
    expect(me.permissions).not.toContain("goal:decide");
  });
});

describe("MCP surface", () => {
  it("advertises every tool with annotations, plus prompts and instructions", async () => {
    const { tools } = await scout.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
    expect(tools).toHaveLength(21);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get("list_tasks")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("forget")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("capture_tasks")?.inputSchema.properties).toHaveProperty("tasks");

    const { prompts } = await scout.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(["daily_review", "scan_sources", "sync_up", "triage_inbox"]);
    const prompt = await scout.getPrompt({ name: "sync_up" });
    expect(JSON.stringify(prompt.messages)).toContain("get_activity");

    expect(scout.getInstructions()).toContain("Phean operating guide");
  });

  it("returns validation and domain failures as actionable tool errors", async () => {
    const invalid = await call(scout, "capture_tasks", { tasks: [] });
    expect(invalid.isError).toBe(true);

    const missing = await call(scout, "get_goal", { goalId: "g_nope" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('not_found: No goal with id "g_nope"');
  });
});

describe("multiple agents sharing a workspace", () => {
  it("coordinates capture, goals, claims, completion, and activity", async () => {
    const goal = dataOf<{ goal: { id: string; status: string }; reviewUrl: string; note: string }>(
      await call(scout, "create_goal", { title: "Close Q3 books" }),
    );
    expect(goal.goal.status).toBe("proposed");
    expect(goal.reviewUrl).toBe(`${TEST_ORIGIN}/w/acme/goals/${goal.goal.id}`);

    const first = dataOf<{ created: { id: string }[] }>(
      await call(scout, "capture_tasks", {
        tasks: [
          { title: "Reconcile bank statements", source: "email", sourceRef: "msg-42", priority: "high" },
          { title: "Chase missing receipts", source: "slack", sourceRef: "C1/p9", goalId: goal.goal.id },
        ],
      }),
    );
    const second = dataOf<{ created: unknown[]; duplicates: { existingTaskId: string }[] }>(
      await call(closer, "capture_tasks", {
        tasks: [{ title: "Reconcile the bank statements", source: "email", sourceRef: "msg-42" }],
      }),
    );
    expect(second.created).toEqual([]);
    expect(second.duplicates[0]?.existingTaskId).toBe(first.created[0]!.id);

    const taskId = first.created[0]!.id;
    dataOf(await call(closer, "assign_tasks_to_goal", { taskIds: [taskId], goalId: goal.goal.id }));
    dataOf(await call(scout, "claim_task", { taskId }));

    const contested = await call(closer, "claim_task", { taskId });
    expect(contested.isError).toBe(true);
    expect(textOf(contested)).toContain("claimed by Scout");

    const next = dataOf<{ tasks: { id: string }[] }>(await call(closer, "suggest_next_actions", { limit: 10 }));
    expect(next.tasks.map((task) => task.id)).not.toContain(taskId);

    const done = dataOf<{ task: { status: string } }>(
      await call(scout, "complete_task", { taskId, note: "Matched all 31 transactions" }),
    );
    expect(done.task.status).toBe("done");

    const activity = dataOf<{ events: { actorName: string; action: string }[]; latestAt: string }>(
      await call(closer, "get_activity", { limit: 50 }),
    );
    expect(activity.events.filter((event) => event.actorName === "Scout").map((event) => event.action)).toEqual(
      expect.arrayContaining(["goal.proposed", "task.captured", "task.claimed", "task.completed"]),
    );
    const since = dataOf<{ events: unknown[] }>(await call(closer, "get_activity", { since: activity.latestAt }));
    expect(since.events.length).toBeGreaterThanOrEqual(1);
    expect(since.events.length).toBeLessThan(activity.events.length);

    const summary = dataOf<{ pendingApprovals: number; agents: number; tasksByStatus: { done: number } }>(
      await call(closer, "get_status_summary"),
    );
    expect(summary).toMatchObject({ pendingApprovals: 1, agents: 2, tasksByStatus: { done: 1 } });
  });

  it("shares long-term memory between agents", async () => {
    dataOf(await call(scout, "remember", { content: "Dana signs off on expenses every Friday", kind: "preference" }));
    const recalled = dataOf<{ memories: { content: string; createdByName: string }[] }>(
      await call(closer, "recall", { query: "expense" }),
    );
    expect(recalled.memories).toEqual([expect.objectContaining({ createdByName: "Scout" })]);
  });

  it("renders Mermaid views and the planning scaffold", async () => {
    const { goals } = dataOf<{ goals: { id: string }[] }>(await call(scout, "list_goals"));
    const kanban = await call(scout, "visualize", { kind: "kanban" });
    expect(textOf(kanban)).toMatch(/^```mermaid\nkanban\n/);

    const tree = await call(scout, "visualize", { kind: "goal_tree", goalId: goals[0]!.id });
    expect(textOf(tree)).toContain("flowchart TD");
    expect(textOf(tree)).toContain("classDef proposed");

    const plan = await call(scout, "plan_goal", { goalId: goals[0]!.id });
    expect(textOf(plan)).toContain("Definition of done");
  });

  it("never lets an agent reach another workspace", async () => {
    const { goals } = dataOf<{ goals: { id: string }[] }>(await call(scout, "list_goals"));
    const probe = await call(outsider, "get_goal", { goalId: goals[0]!.id });
    expect(probe.isError).toBe(true);
    expect(textOf(probe)).toContain("not_found");
    expect(dataOf<{ results: unknown[] }>(await call(outsider, "search", { query: "bank" })).results).toEqual([]);
    expect(dataOf<{ workspace: { slug: string } }>(await call(outsider, "whoami")).workspace.slug).toBe("globex");
  });
});
