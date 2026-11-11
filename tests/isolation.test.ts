import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import { agents, tasks } from "@/server/db/schema";
import { approveAgent, authenticateAgentToken, findRenewableAgent, resolveOAuthAgent, revokeAgent } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";
import { listActivity } from "@/server/domain/events";
import { getDigest } from "@/server/domain/digest";
import { createGoal, findGoal, listGoals, updateGoal, type Goal } from "@/server/domain/goals";
import { attachDocument, deleteDocument, getDocument, listDocuments, updateDocument } from "@/server/domain/documents";
import { countMemoryKinds, forget, recall, remember, type Memory } from "@/server/domain/memory";
import { getWorkflow, saveWorkflow } from "@/server/domain/workflow";
import { getBoard, getGoalDetail, getStatusSummary } from "@/server/domain/overview";
import { search } from "@/server/domain/search";
import {
  answerInput,
  assignTasksToGoal,
  captureTasks,
  claimTask,
  collectAnswers,
  getTask,
  linkSession,
  listDecisions,
  listGoalTasks,
  listTasks,
  requestInput,
  retractAnswer,
  updateTask,
  type Task,
} from "@/server/domain/tasks";
import { getWorkspaceOverviews, listMemberships } from "@/server/domain/tenants";
import { createPheanMcpHandler } from "@/server/mcp/handler";
import { deleteWebhook, watch } from "@/server/domain/webhooks";

import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";
import { connectMcpClient, dataOf, textOf } from "./support/mcp";
import { connectOAuthAgent, createOAuthServer, OAUTH_BASE, OAUTH_RESOURCE } from "./support/oauth";

let testDb: TestDb;
let acme: Workspace;
let globex: Workspace;
let acmeOwner: Ctx;
let globexOwner: Ctx;
let globexAgent: Ctx;
let acmeGoal: Goal;
let acmeTask: Task;
let acmeMemory: Memory;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  [acme, globex] = await Promise.all([
    seedWorkspace(testDb.db),
    seedWorkspace(testDb.db, { name: "Globex", owner: "Eli" }),
  ]);
  acmeOwner = acme.human;
  globexOwner = globex.human;
  globexAgent = globex.scout.ctx;

  acmeGoal = await createGoal(acmeOwner, { title: "Acme secret merger" });
  [acmeTask] = (
    await captureTasks(acmeOwner, {
      tasks: [{ title: "Draft merger memo", goalId: acmeGoal.id, source: "email", sourceRef: "shared-ref" }],
    })
  ).created as [Task];
  acmeMemory = await remember(acmeOwner, { content: "Merger codename is Bluebird" });
});

afterAll(() => testDb.close());

describe("tenant isolation", () => {
  it("hides other tenants' records from lookups and lists", async () => {
    for (const ctx of [globexOwner, globexAgent]) {
      await expect(findGoal(ctx, acmeGoal.id)).rejects.toMatchObject({ code: "not_found" });
      await expect(getGoalDetail(ctx, { goalId: acmeGoal.id })).rejects.toMatchObject({ code: "not_found" });
      await expect(getBoard(ctx, { goalId: acmeGoal.id })).rejects.toMatchObject({ code: "not_found" });
      expect(await listGoals(ctx, {})).toEqual([]);
      expect(await listTasks(ctx, {})).toEqual([]);
      expect(await listGoalTasks(ctx, {})).toEqual([]);
      expect(await getDigest(ctx, {})).toMatchObject({ quiet: true, captured: 0 });
      expect(await recall(ctx, {})).toEqual([]);
      expect(Object.values(await countMemoryKinds(ctx, {})).every((count) => count === 0)).toBe(true);
      expect(await search(ctx, { query: "merger" })).toEqual([]);
      expect(await listActivity(ctx, {})).not.toContainEqual(expect.objectContaining({ actorName: "Dana" }));
      expect((await getStatusSummary(ctx, {})).openTasks).toBe(0);
    }
  });

  it("peeks only into the workspace's own goals' tasks", async () => {
    expect((await listGoalTasks(acmeOwner, {})).map((task) => task.title)).toEqual(["Draft merger memo"]);
  });

  it("keeps questions, decisions, and answers inside their workspace", async () => {
    await requestInput(acme.scout.ctx, { taskId: acmeTask.id, kind: "decision", question: "Sign the merger?", options: ["Yes", "No"] });
    for (const ctx of [globexOwner, globexAgent]) expect(await listDecisions(ctx, {})).toEqual({ open: [], closed: [] });
    const { inputAnswers } = await answerInput(acmeOwner, { taskId: acmeTask.id, answer: "Yes" });
    await expect(retractAnswer(globexOwner, { taskId: acmeTask.id, requestId: inputAnswers[0]!.id })).rejects.toMatchObject({ code: "not_found" });
    expect((await getBoard(globexOwner, { heldBy: acme.scout.agentId })).columns.flatMap((column) => column.tasks)).toEqual([]);
    expect(await collectAnswers(globexAgent, { taskIds: [acmeTask.id] })).toEqual([]);
    expect((await listDecisions(globexOwner, {})).closed).toEqual([]);
    expect((await collectAnswers(acme.scout.ctx, {})).map((answer) => answer.answer)).toEqual(["Yes"]);
  });

  it("rejects writes that reference another tenant's records", async () => {
    const globexGoal = await createGoal(globexOwner, { title: "Globex goal" });

    await expect(updateTask(globexAgent, { taskId: acmeTask.id, title: "pwned" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(claimTask(globexAgent, { taskId: acmeTask.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(linkSession(globexAgent, { taskId: acmeTask.id, session: { sessionId: "s1" } })).rejects.toMatchObject({ code: "not_found" });
    await expect(requestInput(globexAgent, { taskId: acmeTask.id, question: "Who signs?" })).rejects.toMatchObject({ code: "not_found" });
    await expect(captureTasks(globexAgent, { tasks: [{ title: "Sneaky step", parentTaskId: acmeTask.id }] })).rejects.toMatchObject({ code: "not_found" });
    await expect(getTask(globexOwner, { taskId: acmeTask.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(watch(globexAgent, { entityType: "task", entityId: acmeTask.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(watch(globexAgent, { entityType: "goal", entityId: acmeGoal.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(watch(globexAgent, { entityType: "memory", entityId: acmeMemory.id })).rejects.toMatchObject({ code: "not_found" });
    expect(await deleteWebhook(globexOwner, { agentId: acme.scout.agentId })).toEqual({ removed: false });
    await expect(answerInput(globexOwner, { taskId: acmeTask.id, answer: "Me" })).rejects.toMatchObject({ code: "not_found" });
    await expect(
      assignTasksToGoal(globexAgent, { taskIds: [acmeTask.id], goalId: globexGoal.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      captureTasks(globexAgent, { tasks: [{ title: "Sneaky", goalId: acmeGoal.id }] }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(updateGoal(globexOwner, { goalId: globexGoal.id, parentGoalId: acmeGoal.id })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(remember(globexAgent, { content: "x", taskId: acmeTask.id })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(forget(globexOwner, { memoryId: acmeMemory.id })).rejects.toMatchObject({ code: "not_found" });

    expect((await findGoal(acmeOwner, acmeGoal.id)).title).toBe("Acme secret merger");
    expect((await recall(acmeOwner, {})).map((memory) => memory.id)).toEqual([acmeMemory.id]);
  });

  it("keeps documents and their bytes inside their workspace", async () => {
    const memo = await attachDocument(acmeOwner, { title: "Merger memo", taskId: acmeTask.id, summary: "Bluebird terms", content: "Codename Bluebird" });
    for (const ctx of [globexOwner, globexAgent]) {
      await expect(getDocument(ctx, { documentId: memo.id })).rejects.toMatchObject({ code: "not_found" });
      await expect(updateDocument(ctx, { documentId: memo.id, content: "pwned" })).rejects.toMatchObject({ code: "not_found" });
      await expect(deleteDocument(ctx, { documentId: memo.id })).rejects.toMatchObject({ code: "not_found" });
      await expect(attachDocument(ctx, { title: "Sneaky", taskId: acmeTask.id, content: "x" })).rejects.toMatchObject({ code: "not_found" });
      await expect(attachDocument(ctx, { title: "Sneaky", goalId: acmeGoal.id, content: "x" })).rejects.toMatchObject({ code: "not_found" });
      expect(await listDocuments(ctx, { query: "bluebird" })).toEqual([]);
    }
    expect((await getDocument(acmeOwner, { documentId: memo.id })).content).toBe("Codename Bluebird");
  });

  it("keeps sub-agents and memory edits inside their workspace", async () => {
    const { createAgent, revokeAgent } = await import("@/server/domain/agents");
    const { updateMemory } = await import("@/server/domain/memory");
    await expect(createAgent(globexOwner, { name: "Sneaky", parentAgentId: acme.scout.agentId })).rejects.toMatchObject({ code: "not_found" });
    await expect(revokeAgent(globexOwner, { agentId: acme.scout.agentId })).rejects.toMatchObject({ code: "not_found" });
    const { archiveAgent, archiveRevokedAgents, listAgents } = await import("@/server/domain/agents");
    await revokeAgent(acmeOwner, { agentId: acme.closer.agentId });
    await expect(archiveAgent(globexOwner, { agentId: acme.closer.agentId })).rejects.toMatchObject({ code: "not_found" });
    expect(await archiveRevokedAgents(globexOwner, {})).toEqual({ archived: 0 });
    expect((await listAgents(acmeOwner, {})).find((agent) => agent.id === acme.closer.agentId)?.archivedAt).toBeNull();
    await expect(updateMemory(globexOwner, { memoryId: acmeMemory.id, content: "pwned" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("archives tasks only inside their own workspace", async () => {
    const { archiveDoneTasks, archiveTask, unarchiveTask } = await import("@/server/domain/tasks");
    await updateTask(acmeOwner, { taskId: acmeTask.id, status: "done" });
    await expect(archiveTask(globexOwner, { taskId: acmeTask.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(unarchiveTask(globexAgent, { taskId: acmeTask.id })).rejects.toMatchObject({ code: "not_found" });
    expect(await archiveDoneTasks(globexOwner, {})).toEqual({ archived: 0 });
    expect((await getTask(acmeOwner, { taskId: acmeTask.id })).task.archivedAt).toBeNull();
  });

  it("streams only the agent's own workspace's events over the realtime socket", async () => {
    const { runEventStream } = await import("@/server/realtime/stream");
    const sent: string[] = [];
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const socket = {
      readyState: 1,
      bufferedAmount: 0,
      send: (data: string) => void sent.push(data),
      close: () => handlers.close?.forEach((handler) => handler()),
      terminate: () => handlers.close?.forEach((handler) => handler()),
      ping: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => void) => void (handlers[event] = [...(handlers[event] ?? []), handler]),
    };
    const principal = { agent: { id: globex.scout.agentId, name: "Scout", level: "write" as const }, accessExpiresAt: null, tenant: globex.tenant };
    const done = runEventStream(socket as never, { db: testDb.db, principal, options: { topics: ["tasks", "goals", "memory", "decisions"], scope: "all", after: 0 }, origin: "https://phean.test", limits: { pollMs: 20 } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    socket.close();
    await done;
    const pushed = sent.map((data) => JSON.parse(data) as { type: string; events?: { summary: string }[] }).flatMap((message) => message.events ?? []);
    expect(pushed.map((event) => event.summary).join("\n")).not.toMatch(/merger|Bluebird/i);
  });

  it("keeps each workspace's stages its own", async () => {
    const stages = await getWorkflow(acmeOwner, {});
    await saveWorkflow(acmeOwner, { stages: [...stages, { label: "Legal review", kind: "in_progress" as const, hidden: false }] });
    expect((await getWorkflow(globexOwner, {})).map((stage) => stage.key)).not.toContain("legal-review");
    const [globexTask] = (await captureTasks(globexOwner, { tasks: [{ title: "Globex work", status: "todo" }] })).created as [Task];
    await expect(updateTask(globexOwner, { taskId: globexTask.id, stage: "legal-review" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("scopes duplicate detection to the tenant", async () => {
    const result = await captureTasks(globexAgent, {
      tasks: [{ title: "Unrelated", source: "email", sourceRef: "shared-ref" }],
    });
    expect(result.created).toHaveLength(1);
    expect(result.duplicates).toEqual([]);
  });

  it("blocks cross-tenant links in the database itself", async () => {
    await expect(
      testDb.db.insert(tasks).values({
        id: "t_crosstenant",
        tenantId: globexOwner.tenant.id,
        goalId: acmeGoal.id,
        title: "Direct insert",
        createdByType: "user",
        createdById: "x",
        createdByName: "x",
      }),
    ).rejects.toThrow();
  });

  it("binds agent tokens to their own workspace", async () => {
    const principal = await authenticateAgentToken(testDb.db, globex.scout.token);
    expect(principal?.tenant).toEqual(globex.tenant);
  });

  it("binds an OAuth agent to its own workspace, and keeps other workspaces from revoking or renewing it", async () => {
    const grant = { name: "Laptop", level: "write", lifetimeDays: 30, oauthClientId: "client_1" } as const;
    const { agent } = await approveAgent(acmeOwner, grant);
    expect((await resolveOAuthAgent(testDb.db, agent.id))?.tenant).toEqual(acme.tenant);

    await expect(revokeAgent(globexOwner, { agentId: agent.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(revokeAgent(globexAgent, { agentId: agent.id })).rejects.toMatchObject({ code: "not_found" });

    // The same person in another workspace: it is not theirs to renew there, nor its sub-agents to revoke.
    const samePerson = { ...globexOwner, actor: acmeOwner.actor };
    const { createSubagent, agentContext } = await import("@/server/domain/agents");
    const { agent: worker } = await createSubagent(agentContext(testDb.db, (await resolveOAuthAgent(testDb.db, agent.id))!), { name: "Worker" });
    await expect(revokeAgent(samePerson, { agentId: worker.id })).rejects.toMatchObject({ code: "not_found" });
    expect(await findRenewableAgent(samePerson, "Laptop")).toBeNull();
    const { agent: there, renewed } = await approveAgent(samePerson, grant);
    expect(renewed).toBe(false);
    expect(there.id).not.toBe(agent.id);
    expect((await resolveOAuthAgent(testDb.db, agent.id))?.tenant).toEqual(acme.tenant);
  });

  describe("over an OAuth token", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("an OAuth token for one workspace never sees another's goals", async () => {
      const server = createOAuthServer(testDb.db);
      const connected = await connectOAuthAgent(testDb.db, server, "oauth-acme");
      await createGoal(connected.ctx, { title: "Connected workspace's goal" });
      const client = await connectMcpClient(server.handler, connected.accessToken, { url: OAUTH_RESOURCE });
      try {
        const me = dataOf<{ workspace: { id: string } }>(await client.callTool({ name: "whoami", arguments: {} }));
        expect(me.workspace.id).toBe(connected.tenant.id);
        const listed = textOf(await client.callTool({ name: "list_goals", arguments: {} }));
        expect(listed).toContain("Connected workspace's goal");
        expect(listed).not.toContain(acmeGoal.title);
        const reached = await client.callTool({ name: "get_goal", arguments: { goalId: acmeGoal.id } });
        expect(reached.isError).toBe(true);
      } finally {
        await client.close();
      }
    });

    it("a workspace's own URL lets in only that workspace's agents", async () => {
      const server = createOAuthServer(testDb.db);
      const connected = await connectOAuthAgent(testDb.db, server, "oauth-acme");
      const handler = createPheanMcpHandler({ getDb: () => testDb.db, verifyOAuthToken: () => Promise.resolve({ agentId: connected.agentId, clientId: connected.clientId, issuedAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 3600 }) });
      // Another workspace's key, and a token the verifier accepts but whose agent works elsewhere.
      await expect(connectMcpClient(handler, globex.scout.token, { url: `${OAUTH_BASE}/mcp/w/${acme.tenant.slug}` })).rejects.toThrow();
      await expect(connectMcpClient(handler, "verified-token", { url: `${OAUTH_BASE}/mcp/w/${acme.tenant.slug}` })).rejects.toThrow();
      const own = await connectMcpClient(handler, globex.scout.token, { url: `${OAUTH_BASE}/mcp/w/${globex.tenant.slug}` });
      try {
        const me = dataOf<{ workspace: { id: string } }>(await own.callTool({ name: "whoami", arguments: {} }));
        expect(me.workspace.id).toBe(globex.tenant.id);
      } finally {
        await own.close();
      }
    });
  });

  it("keeps the admin tools list_agents, list_members and revoke_agent inside the agent's workspace", async () => {
    await testDb.db.update(agents).set({ accessLevel: "admin" }).where(eq(agents.id, globex.scout.agentId));
    const client = await connectMcpClient(createPheanMcpHandler({ getDb: () => testDb.db }), globex.scout.token);
    try {
      const listed = dataOf<{ agents: { id: string; name: string }[] }>(await client.callTool({ name: "list_agents", arguments: {} }));
      expect(listed.agents.map((agent) => agent.id)).toContain(globex.scout.agentId);
      expect(listed.agents.map((agent) => agent.id)).not.toContain(acme.scout.agentId);

      const members = dataOf<{ members: { name: string }[] }>(await client.callTool({ name: "list_members", arguments: {} }));
      expect(members.members).toEqual([{ name: "Eli", role: "owner" }]);

      const reached = await client.callTool({ name: "revoke_agent", arguments: { agentId: acme.scout.agentId } });
      expect(reached.isError).toBe(true);
      expect(textOf(reached)).toContain("not_found");
      expect(await authenticateAgentToken(testDb.db, acme.scout.token)).not.toBeNull();
    } finally {
      await client.close();
    }
  });

  it("shows each user only the workspaces they belong to", async () => {
    const memberships = await listMemberships(testDb.db, acmeOwner.actor.id);
    expect(memberships.map((membership) => [membership.tenant.slug, membership.role])).toEqual([[acme.tenant.slug, "owner"]]);

    const [overview] = await getWorkspaceOverviews(testDb.db, memberships);
    expect(overview).toMatchObject({ openTasks: 1, inbox: 1, activeGoals: 1, agents: 2 });
  });
});
