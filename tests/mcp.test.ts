import type { Client } from "@modelcontextprotocol/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { isoDayFromToday } from "@/lib/dates";
import { createAgent, revokeAgent } from "@/server/domain/agents";
import { answerInput } from "@/server/domain/tasks";
import { createPheanMcpHandler } from "@/server/mcp/handler";
import { TOOLS } from "@/server/mcp/tools";
import { dispatchDue } from "@/server/webhooks/dispatch";

import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";
import { connectMcpClient, dataOf, MCP_URL, TEST_ORIGIN, textOf } from "./support/mcp";

let testDb: TestDb;
let handler: (request: Request) => Promise<Response>;
let ws: Workspace;
let scout: Client;
let closer: Client;
let outsider: Client;

const call = (client: Client, name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args });

beforeAll(async () => {
  testDb = await createTestDb();
  const { db } = testDb;
  handler = createPheanMcpHandler({ getDb: () => db });
  outsider = await connectMcpClient(handler, (await seedWorkspace(db)).scout.token);
});

beforeEach(async () => {
  ws = await seedWorkspace(testDb.db);
  [scout, closer] = await Promise.all([connectMcpClient(handler, ws.scout.token), connectMcpClient(handler, ws.closer.token)]);
});

afterEach(() => Promise.all([scout.close(), closer.close()]));

afterAll(async () => {
  await outsider?.close();
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

    const { agent, token } = await createAgent(ws.human, { name: "Temp" });
    expect((await initialize({ authorization: `Bearer ${token}` })).status).toBe(200);
    await revokeAgent(ws.human, { agentId: agent.id });
    expect((await initialize({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("identifies the agent and workspace from the token alone", async () => {
    const me = dataOf(await call(scout, "whoami"));
    expect(me).toMatchObject({
      agent: { id: ws.scout.agentId, name: "Scout" },
      workspace: { slug: ws.tenant.slug },
      dashboardUrl: `${TEST_ORIGIN}/w/${ws.tenant.slug}`,
    });
    expect(me.permissions).not.toContain("goal:decide");
  });
});

describe("MCP surface", () => {
  it("advertises every tool with annotations, plus prompts and instructions", async () => {
    const { tools } = await scout.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
    expect(tools).toHaveLength(42);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get("list_tasks")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("forget")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("capture_tasks")?.inputSchema.properties).toHaveProperty("tasks");
    expect(byName.get("claim_task")?.inputSchema.properties).toHaveProperty("session.properties.url");

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

  it("names a service's result after what it is, unless the result is already an object of its own", async () => {
    const {
      created: [task],
    } = dataOf<{ created: { id: string }[] }>(await call(scout, "capture_tasks", { tasks: [{ title: "Water the plants" }] }));
    const updated = dataOf(await call(scout, "update_task", { taskId: task!.id, priority: "high" }));
    expect(Object.keys(updated)).toEqual(["task"]);
    expect(updated.task).toMatchObject({ id: task!.id, priority: "high" });

    const listed = dataOf<{ tasks: unknown[] }>(await call(scout, "list_tasks"));
    expect(listed.tasks).toHaveLength(1);

    const { memory } = dataOf<{ memory: { id: string } }>(await call(scout, "remember", { content: "Plants need water on Mondays" }));
    expect(dataOf(await call(scout, "forget", { memoryId: memory.id }))).toEqual({ forgotten: memory.id });
  });
});

describe("sub-agents sharing their agent's key", () => {
  it("detects each named worker as a sub-agent, attributes its work to it, and refuses a revoked name", async () => {
    const researcher = await connectMcpClient(handler, ws.scout.token, { agentName: "Vendor researcher" });
    const { agent } = dataOf<{ agent: { id: string; name: string } }>(await call(researcher, "whoami"));
    expect(agent.name).toBe("Vendor researcher");
    const { created } = dataOf<{ created: { createdByName: string }[] }>(await call(researcher, "capture_tasks", { tasks: [{ title: "Compare three vendors" }] }));
    expect(created[0]).toMatchObject({ createdByName: "Vendor researcher" });

    // The same name on another connection is the same sub-agent; a URL parameter works for clients that only take a URL.
    const again = await connectMcpClient(handler, ws.scout.token, { url: `${MCP_URL}?agent=Vendor%20researcher` });
    expect(dataOf<{ agent: { id: string } }>(await call(again, "whoami")).agent.id).toBe(agent.id);
    const { listAgents, revokeAgent } = await import("@/server/domain/agents");
    expect((await listAgents(ws.human, {})).find((row) => row.id === agent.id)).toMatchObject({ parentAgentId: ws.scout.agentId, sharesParentKey: true });

    // The agent itself still connects as itself, and revoking the name shuts the worker out.
    expect(dataOf<{ agent: { id: string } }>(await call(scout, "whoami")).agent.id).toBe(ws.scout.agentId);
    await revokeAgent(ws.human, { agentId: agent.id });
    await expect(connectMcpClient(handler, ws.scout.token, { agentName: "Vendor researcher" })).rejects.toThrow();
    await Promise.all([researcher.close(), again.close()]);
  });
});

describe("documents and stages over MCP", () => {
  it("lets one agent hand a task to another through a document, and names the board's stages in whoami", async () => {
    const { workflow } = dataOf<{ workflow: { key: string; label: string; status: string }[] }>(await call(scout, "whoami"));
    expect(workflow.map((stage) => stage.key)).toEqual(["inbox", "backlog", "todo", "in_progress", "done"]);

    const {
      created: [task],
    } = dataOf<{ created: { id: string }[] }>(await call(scout, "capture_tasks", { tasks: [{ title: "Draft the Q3 letter", status: "backlog" }] }));
    const attached = dataOf<{ document: { id: string; version: number }; url: string }>(
      await call(scout, "attach_document", {
        title: "Handoff: Q3 letter",
        taskId: task!.id,
        summary: "Where the letter stands",
        content: "Done: outline. Next: figures.\n\n```mermaid\nflowchart LR\n  A --> B\n```",
      }),
    );
    expect(attached.url).toBe(`${TEST_ORIGIN}/w/${ws.tenant.slug}/documents/${attached.document.id}`);

    const { task: picked } = dataOf<{ task: { status: string; documents: { id: string }[] } }>(await call(closer, "get_task", { taskId: task!.id }));
    expect(picked).toMatchObject({ status: "backlog", documents: [{ id: attached.document.id }] });
    const read = dataOf<{ content: string; document: { version: number } }>(await call(closer, "get_document", { documentId: attached.document.id }));
    expect(read.content).toContain("Next: figures.");

    // Another agent's document is not the closer's to change; a stale version is refused for anyone.
    expect((await call(closer, "update_document", { documentId: attached.document.id, content: "mine" })).isError).toBe(true);
    const stale = await call(scout, "update_document", { documentId: attached.document.id, content: "v2", expectedVersion: 7 });
    expect(textOf(stale)).toContain("conflict:");
    expect(dataOf(await call(scout, "update_document", { documentId: attached.document.id, content: "v2", expectedVersion: 1 }))).toMatchObject({
      document: { version: 2 },
    });
  });
});

describe("multiple agents sharing a workspace", () => {
  it("coordinates capture, goals, claims, completion, and activity", async () => {
    const goal = dataOf<{ goal: { id: string; status: string }; reviewUrl: string; note: string }>(
      await call(scout, "create_goal", { title: "Close Q3 books" }),
    );
    expect(goal.goal.status).toBe("proposed");
    expect(goal.reviewUrl).toBe(`${TEST_ORIGIN}/w/${ws.tenant.slug}/goals/${goal.goal.id}`);

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

    const summary = dataOf<{ pendingApprovals: number; agents: number; tasksByStatus: { done: number }; dashboardUrl: string }>(
      await call(closer, "get_status_summary"),
    );
    expect(summary).toMatchObject({
      pendingApprovals: 1,
      agents: 2,
      tasksByStatus: { done: 1 },
      dashboardUrl: `${TEST_ORIGIN}/w/${ws.tenant.slug}`,
    });
  });

  it("asks the human through Phean and hands the answer back to the agent", async () => {
    const {
      created: [task],
    } = dataOf<{ created: { id: string }[] }>(await call(scout, "capture_tasks", { tasks: [{ title: "Pick the offsite city", status: "todo" }] }));
    const session = { url: "https://claude.ai/chat/7c1f", app: "Claude", brief: "Shortlisted Lisbon and Porto" };
    dataOf(await call(scout, "claim_task", { taskId: task!.id, session }));

    const rejected = await call(scout, "link_session", { taskId: task!.id, session: { url: "javascript:alert(document.cookie)" } });
    expect(rejected.isError).toBe(true);
    expect(textOf(rejected)).toContain("Use an https link");

    const asked = dataOf<{ task: { inputRequest: { question: string } }; decisionsUrl: string }>(
      await call(scout, "request_input", { taskId: task!.id, question: "Lisbon or Porto?" }),
    );
    expect(asked.task.inputRequest.question).toBe("Lisbon or Porto?");
    expect(asked.decisionsUrl).toBe(`${TEST_ORIGIN}/w/${ws.tenant.slug}/decisions`);

    const summary = dataOf<{ awaitingInput: number; awaitingInputTasks: { id: string; agentSessions: { url: string }[] }[] }>(
      await call(closer, "get_status_summary"),
    );
    expect(summary.awaitingInput).toBe(1);
    expect(summary.awaitingInputTasks[0]).toMatchObject({ id: task!.id, agentSessions: [{ url: session.url }] });

    await answerInput(ws.human, { taskId: task!.id, answer: "Porto" });
    const { events } = dataOf<{ events: { action: string; data: { answer?: string } }[] }>(await call(scout, "get_activity", { limit: 1 }));
    expect(events[0]).toMatchObject({ action: "task.input_answered", data: { answer: "Porto" } });
    expect(dataOf<{ task: { inputRequest: unknown } }>(await call(scout, "resolve_input", { taskId: task!.id })).task.inputRequest).toBeNull();
  });

  it("lets an agent ask for a decision, wait, and wake with the human's answer", async () => {
    const {
      created: [task],
    } = dataOf<{ created: { id: string }[] }>(await call(scout, "capture_tasks", { tasks: [{ title: "Pick the auditor", status: "todo" }] }));
    const asked = dataOf<{ task: { inputRequest: { kind: string; options: string[]; links: { kind: string }[] } } }>(
      await call(scout, "request_input", {
        taskId: task!.id,
        kind: "decision",
        question: "Rivera or Okafor?",
        options: ["Rivera", "Okafor"],
        links: [{ url: "https://claude.ai/chat/9", title: "This chat", kind: "conversation" }],
      }),
    );
    expect(asked.task.inputRequest).toMatchObject({ kind: "decision", options: ["Rivera", "Okafor"], links: [{ kind: "conversation" }] });

    expect(dataOf(await call(scout, "wait_for_answers", { timeoutSeconds: 1 }))).toEqual({ answers: [], timedOut: true, stillOpen: 1 });

    setTimeout(() => void answerInput(ws.human, { taskId: task!.id, answer: "Okafor" }), 200);
    const woken = dataOf<{ answers: { answer: string; chosenOption: string }[]; timedOut: boolean }>(
      await call(scout, "wait_for_answers", { taskIds: [task!.id], timeoutSeconds: 20 }),
    );
    expect(woken).toMatchObject({ timedOut: false, answers: [{ answer: "Okafor", chosenOption: "Okafor" }] });
    expect(dataOf(await call(scout, "collect_answers"))).toEqual({ answers: [] });
  });

  it("lets an agent read a task whole and fix it in place", async () => {
    const {
      created: [parent],
    } = dataOf<{ created: { id: string }[] }>(await call(scout, "capture_tasks", { tasks: [{ title: "Launch the pricing page", status: "todo" }] }));
    dataOf(await call(scout, "capture_tasks", { tasks: [{ title: "Write the FAQ", parentTaskId: parent!.id }] }));
    const fixed = dataOf<{ task: { title: string; links: { url: string }[] } }>(
      await call(closer, "update_task", { taskId: parent!.id, title: "Launch the new pricing page", addLinks: [{ url: "https://github.com/acme/site/pull/7", kind: "doc" }] }),
    );
    expect(fixed.task).toMatchObject({ title: "Launch the new pricing page", links: [{ url: "https://github.com/acme/site/pull/7" }] });
    const detail = dataOf<{ task: { subtaskCount: number }; subtasks: { title: string }[]; activity: { action: string }[]; boardUrl: string }>(
      await call(scout, "get_task", { taskId: parent!.id }),
    );
    expect(detail).toMatchObject({ task: { subtaskCount: 1 }, subtasks: [{ title: "Write the FAQ" }], boardUrl: `${TEST_ORIGIN}/w/${ws.tenant.slug}/board` });
    expect(detail.activity.map((event) => event.action)).toEqual(["task.updated", "task.captured"]);
  });

  it("lets an agent register a webhook and receive the human's answer on it", async () => {
    vi.stubEnv("PHEAN_WEBHOOK_ALLOW_PRIVATE", "1");
    try {
      const registered = dataOf<{ webhook: { id: string; status: string; topics: string[] }; secret: string; verify: string }>(
        await call(scout, "register_webhook", { url: "https://bots.example.com/scout", topics: ["decisions"] }),
      );
      expect(registered.webhook).toMatchObject({ status: "active", topics: ["decisions"] });
      expect(registered.secret).toMatch(/^whsec_/);
      expect(registered.verify).toContain("HMAC-SHA256");
      expect(JSON.stringify(dataOf(await call(scout, "get_webhook")))).not.toContain(registered.secret);

      const {
        created: [task],
      } = dataOf<{ created: { id: string }[] }>(await call(scout, "capture_tasks", { tasks: [{ title: "Pick a venue", status: "todo" }] }));
      dataOf(await call(scout, "request_input", { taskId: task!.id, kind: "decision", question: "Lisbon or Porto?", options: ["Lisbon", "Porto"] }));
      expect(dataOf<{ watches: { entityId: string }[] }>(await call(scout, "list_watches")).watches).toEqual([expect.objectContaining({ entityId: task!.id, reason: "auto" })]);
      await answerInput(ws.human, { taskId: task!.id, answer: "Porto" });

      const bodies: string[] = [];
      const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(String(init!.body));
        return new Response(null, { status: 204 });
      }) as typeof globalThis.fetch;
      await dispatchDue(testDb.db, { fetch, resolve: async () => [], allowPrivate: true, baseUrl: TEST_ORIGIN, budgetMs: 5_000 });
      const delivered = bodies.map((body) => JSON.parse(body)).find((payload) => payload.webhookId === registered.webhook.id);
      expect(delivered.events).toEqual([expect.objectContaining({ action: "task.input_answered", reasons: expect.arrayContaining(["asked_by_you"]) })]);

      const status = dataOf<{ counts: { delivered: number } }>(await call(scout, "get_webhook"));
      expect(status.counts.delivered).toBe(1);
      expect(dataOf(await call(scout, "delete_webhook"))).toEqual({ removed: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hands back the cursor it was given when nothing happened since", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(dataOf(await call(closer, "get_activity", { since: future }))).toEqual({ events: [], latestAt: future });
  });

  it("shares long-term memory between agents", async () => {
    dataOf(await call(scout, "remember", { content: "Dana signs off on expenses every Friday", kind: "preference" }));
    const recalled = dataOf<{ memories: { content: string; createdByName: string }[] }>(
      await call(closer, "recall", { query: "expense" }),
    );
    expect(recalled.memories).toEqual([expect.objectContaining({ createdByName: "Scout" })]);
  });

  it("renders Mermaid views and the planning scaffold", async () => {
    const { goal } = dataOf<{ goal: { id: string } }>(await call(scout, "create_goal", { title: "Year-end audit" }));
    await call(scout, "capture_tasks", { tasks: [{ title: "Send the trial balance", goalId: goal.id, dueDate: isoDayFromToday(5) }] });

    const kanban = await call(scout, "visualize", { kind: "kanban" });
    expect(textOf(kanban)).toMatch(/^```mermaid\nkanban\n/);
    expect(textOf(kanban)).toContain("Inbox: 1");

    const tree = await call(scout, "visualize", { kind: "goal_tree", goalId: goal.id });
    expect(textOf(tree)).toContain("flowchart TD");
    expect(textOf(tree)).toContain("classDef proposed");
    expect(textOf(tree)).toContain("Send the trial balance");

    const timeline = await call(scout, "visualize", { kind: "timeline" });
    expect(textOf(timeline)).toMatch(/^```mermaid\ngantt\n/);
    expect(textOf(timeline)).toContain("1 task with due dates.");

    const plan = await call(scout, "plan_goal", { goalId: goal.id });
    expect(textOf(plan)).toContain("Definition of done");
  });

  it("never lets an agent reach another workspace", async () => {
    const { goal } = dataOf<{ goal: { id: string } }>(await call(scout, "create_goal", { title: "Bank covenant review" }));
    const probe = await call(outsider, "get_goal", { goalId: goal.id });
    expect(probe.isError).toBe(true);
    expect(textOf(probe)).toContain("not_found");
    expect(dataOf<{ results: unknown[] }>(await call(outsider, "search", { query: "bank" })).results).toEqual([]);
    expect(dataOf<{ workspace: { slug: string } }>(await call(outsider, "whoami")).workspace.slug).not.toBe(ws.tenant.slug);
  });
});
