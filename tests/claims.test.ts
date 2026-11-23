import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agents, events, watches } from "@/server/db/schema";
import { agentContext, approveAgent, authenticateAgentToken, createSubagent, listOwnAgents, resolveNamedSubagent, resolveOAuthAgent, revokeAgent } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";
import {
  addTask,
  answerInput,
  claimTask,
  collectAnswers,
  completeTask,
  getTask,
  handOffTask,
  linkSession,
  releaseTask,
  requestInput,
  transferClaims,
  updateTask,
  type Task,
} from "@/server/domain/tasks";

import { addMember, asUser, createTestDb, seedUser, seedWorkspace, type TestDb, type TestUser, type Workspace } from "./support/db";

let testDb: TestDb;
let ws: Workspace;
let mia: TestUser;
let miaCtx: Ctx;
let claude: { id: string; ctx: Ctx };
let content: { id: string; ctx: Ctx };
let task: Task;

const grant = { level: "write", lifetimeDays: 30, oauthClientId: "client_1" } as const;

/** An agent's context the way the OAuth path builds it. */
async function signedIn(agentId: string): Promise<Ctx> {
  const principal = await resolveOAuthAgent(testDb.db, agentId);
  if (!principal) throw new Error("agent did not resolve");
  return agentContext(testDb.db, principal);
}

async function approved(ctx: Ctx, name: string, level: "read" | "write" | "admin" = "write") {
  const { agent } = await approveAgent(ctx, { ...grant, name, level });
  return { id: agent.id, ctx: await signedIn(agent.id) };
}

/** A sub-agent with a token of its own, made by its parent, as the parent's MCP session would. */
async function subagentOf(parent: Ctx, name: string) {
  const { agent, token } = await createSubagent(parent, { name });
  const principal = await authenticateAgentToken(testDb.db, token);
  return { id: agent.id, ctx: agentContext(testDb.db, principal!), token };
}

async function lastEvent(entityId: string) {
  const rows = await testDb.db.select().from(events).where(eq(events.entityId, entityId)).orderBy(events.id);
  return rows.at(-1)!;
}

const view = async (taskId = task.id) => (await getTask(ws.human, { taskId })).task;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  ws = await seedWorkspace(testDb.db);
  mia = await seedUser(testDb.db, "Mia");
  await addMember(testDb.db, ws.tenant, mia, "member");
  miaCtx = asUser(testDb.db, ws.tenant, mia, "member");
  claude = await approved(miaCtx, "Claude");
  content = await approved(miaCtx, "Claude Content Agent");
  task = (await addTask(ws.human, { title: "Build Q3 2026 board deck", status: "todo" })).created[0]!;
});

afterAll(() => testDb.close());

describe("a family shares its claims", () => {
  it("lets a sub-agent work its parent's claim, and records that it did so for the parent", async () => {
    await claimTask(claude.ctx, { taskId: task.id });
    const worker = await subagentOf(claude.ctx, "Deck writer");

    await linkSession(worker.ctx, { taskId: task.id, session: { app: "Claude Code", sessionId: "s-1" } });
    await updateTask(worker.ctx, { taskId: task.id, priority: "high" });
    const done = await completeTask(worker.ctx, { taskId: task.id, note: "Deck drafted" });
    expect(done).toMatchObject({ status: "done", claimedByAgentId: null, operatorUserId: null });
    expect(done.description).toContain("Completion note (Deck writer): Deck drafted");

    const completed = await lastEvent(task.id);
    expect(completed).toMatchObject({ action: "task.completed", actorType: "agent", actorId: worker.id, summary: `completed "${task.title}" for Claude` });
    expect(completed.data).toMatchObject({ claimedByAgentId: claude.id });
  });

  it("lets a parent work its sub-agent's claim, and siblings work each other's", async () => {
    const one = await subagentOf(claude.ctx, "Researcher");
    const two = await subagentOf(claude.ctx, "Writer");
    await claimTask(one.ctx, { taskId: task.id });

    await updateTask(claude.ctx, { taskId: task.id, priority: "urgent" });
    await requestInput(two.ctx, { taskId: task.id, question: "Which quarter's numbers?", kind: "question" });
    const released = await releaseTask(two.ctx, { taskId: task.id, note: "Over to whoever is free" });
    expect(released).toMatchObject({ claimedByAgentId: null, delegation: "returned", inputRequest: null });
    expect(await lastEvent(task.id)).toMatchObject({ action: "task.released", actorId: two.id, summary: `released "${task.title}" for Researcher` });
  });

  it("a detected sub-agent on its parent's credential shares the claim too", async () => {
    await claimTask(claude.ctx, { taskId: task.id });
    const principal = await resolveOAuthAgent(testDb.db, claude.id);
    const named = await resolveNamedSubagent(testDb.db, principal!, "Grok research");
    const grok = agentContext(testDb.db, named!);
    expect(grok.actor.id).not.toBe(claude.id);
    await expect(updateTask(grok, { taskId: task.id, status: "done" })).resolves.toMatchObject({ status: "done" });
  });

  it("claiming within the family moves the claim and records whose it was", async () => {
    const worker = await subagentOf(claude.ctx, "Deck writer");
    await claimTask(claude.ctx, { taskId: task.id });
    expect(await claimTask(worker.ctx, { taskId: task.id })).toMatchObject({ claimedByAgentId: worker.id });
    expect((await lastEvent(task.id)).data).toMatchObject({ fromAgentId: claude.id });
  });

  it("still refuses agents of another family, and sub-agents of another parent", async () => {
    await claimTask(claude.ctx, { taskId: task.id });
    const stranger = await subagentOf(content.ctx, "Content worker");
    for (const ctx of [content.ctx, stranger.ctx, ws.scout.ctx]) {
      await expect(completeTask(ctx, { taskId: task.id })).rejects.toMatchObject({ code: "conflict" });
      await expect(releaseTask(ctx, { taskId: task.id })).rejects.toMatchObject({ code: "conflict" });
      await expect(updateTask(ctx, { taskId: task.id, status: "todo" })).rejects.toMatchObject({ code: "conflict" });
    }
    expect(await view()).toMatchObject({ claimedByAgentId: claude.id, status: "in_progress" });
  });

  it("a Read sub-agent still cannot write its family's claimed work", async () => {
    await claimTask(claude.ctx, { taskId: task.id });
    const worker = await subagentOf(claude.ctx, "Reader");
    await testDb.db.update(agents).set({ accessLevel: "read" }).where(eq(agents.id, worker.id));
    const reader = agentContext(testDb.db, (await authenticateAgentToken(testDb.db, worker.token))!);
    expect(reader.actor.role).toBe("agent_read");
    await expect(completeTask(reader, { taskId: task.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(releaseTask(reader, { taskId: task.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateTask(reader, { taskId: task.id, priority: "low" })).rejects.toMatchObject({ code: "forbidden" });
    expect(await view()).toMatchObject({ claimedByAgentId: claude.id, status: "in_progress" });
  });
});

describe("handing one agent's claims to another", () => {
  it("moves every open claim of the agent and its sub-agents, and nothing else", async () => {
    const worker = await subagentOf(claude.ctx, "Deck writer");
    const [mine, theirs, finished, scouts] = (
      await addTask(ws.human, { title: "Second", status: "todo" }).then(async (first) => [
        first.created[0]!,
        (await addTask(ws.human, { title: "Third", status: "todo" })).created[0]!,
        (await addTask(ws.human, { title: "Fourth", status: "todo" })).created[0]!,
        (await addTask(ws.human, { title: "Fifth", status: "todo" })).created[0]!,
      ])
    ) as [Task, Task, Task, Task];
    await claimTask(claude.ctx, { taskId: task.id });
    await claimTask(claude.ctx, { taskId: mine.id });
    await claimTask(worker.ctx, { taskId: theirs.id });
    await claimTask(claude.ctx, { taskId: finished.id });
    await completeTask(claude.ctx, { taskId: finished.id });
    await claimTask(ws.scout.ctx, { taskId: scouts.id });
    expect((await listOwnAgents(miaCtx)).find((agent) => agent.id === claude.id)).toMatchObject({ subagents: ["Deck writer"], openClaims: 3 });

    const { moved } = await transferClaims(miaCtx, { fromAgentId: claude.id, toAgentId: content.id });
    expect(moved.map((row) => row.id).sort()).toEqual([task.id, mine.id, theirs.id].sort());
    for (const row of moved) expect(row).toMatchObject({ claimedByAgentId: content.id, operatorUserId: null, status: "in_progress", delegation: null });
    expect(await view(finished.id)).toMatchObject({ status: "done", claimedByAgentId: null });
    expect(await view(scouts.id)).toMatchObject({ claimedByAgentId: ws.scout.agentId });
    expect(await lastEvent(task.id)).toMatchObject({
      action: "task.claim_transferred",
      actorType: "user",
      actorId: mia.id,
      summary: `handed "${task.title}" from Claude to Claude Content Agent`,
    });
    expect((await lastEvent(theirs.id)).data).toMatchObject({ fromAgentId: worker.id, toAgentId: content.id });

    // The new operator follows the work, so it hears of later changes; the old agent is left as it was.
    const followed = await testDb.db.select({ id: watches.entityId }).from(watches).where(and(eq(watches.agentId, content.id), eq(watches.entityType, "task")));
    expect(followed.map((row) => row.id).sort()).toEqual([task.id, mine.id, theirs.id].sort());
    const [left] = await testDb.db.select().from(agents).where(eq(agents.id, claude.id));
    expect(left!.revokedAt).toBeNull();
    // It now operates them, and the agent that held them does not.
    await expect(completeTask(content.ctx, { taskId: task.id })).resolves.toMatchObject({ status: "done" });
    await expect(completeTask(claude.ctx, { taskId: mine.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("brings an open question along, so the answer is delivered to the new operator once", async () => {
    await claimTask(claude.ctx, { taskId: task.id });
    const asked = await requestInput(claude.ctx, { taskId: task.id, question: "Which template?", kind: "decision", options: ["Old", "New"] });
    const requestId = asked.inputRequest!.id;

    await transferClaims(miaCtx, { fromAgentId: claude.id, toAgentId: content.id });
    expect((await view()).inputRequest).toMatchObject({ id: requestId, agentId: content.id, agentName: "Claude Content Agent", question: "Which template?" });

    await answerInput(miaCtx, { taskId: task.id, answer: "New" });
    expect(await collectAnswers(claude.ctx, {})).toEqual([]);
    const answers = await collectAnswers(content.ctx, {});
    expect(answers).toMatchObject([{ taskId: task.id, requestId, answer: "New", chosenOption: "New" }]);
    expect(await collectAnswers(content.ctx, {})).toEqual([]);
  });

  it("brings an answer not yet collected along, and a sub-agent's question too", async () => {
    const worker = await subagentOf(claude.ctx, "Deck writer");
    await claimTask(worker.ctx, { taskId: task.id });
    await requestInput(worker.ctx, { taskId: task.id, question: "Which numbers?", kind: "question" });
    await answerInput(miaCtx, { taskId: task.id, answer: "Q2 actuals" });

    await transferClaims(miaCtx, { fromAgentId: claude.id, toAgentId: content.id });
    expect(await collectAnswers(worker.ctx, {})).toEqual([]);
    expect(await collectAnswers(content.ctx, {})).toMatchObject([{ taskId: task.id, answer: "Q2 actuals" }]);
    const record = (await view()).inputAnswers[0]!;
    expect(record).toMatchObject({ agentId: content.id, collected: true });
    expect(record.viaAgentName).toBeUndefined();
  });

  it("a handoff meant for the new operator becomes its pick-up; any other handoff stays under way", async () => {
    const other = (await addTask(ws.human, { title: "Other", status: "todo" })).created[0]!;
    await claimTask(claude.ctx, { taskId: task.id });
    await claimTask(claude.ctx, { taskId: other.id });
    await handOffTask(claude.ctx, { taskId: task.id, toAgent: content.id, note: "Yours" });
    await handOffTask(claude.ctx, { taskId: other.id, toAgent: "Scout", note: "Scout's" });

    await transferClaims(miaCtx, { fromAgentId: claude.id, toAgentId: content.id });
    expect(await view()).toMatchObject({ claimedByAgentId: content.id, delegation: "picking_up", delegateToAgentId: null, delegationNote: "Yours" });
    expect(await view(other.id)).toMatchObject({ claimedByAgentId: content.id, delegation: "handing_off", delegateToAgentId: ws.scout.agentId });
  });

  it("hands the family's handoffs to the new agent too: it hears how they go, and work comes back to it", async () => {
    const worker = await subagentOf(claude.ctx, "Deck writer");
    const other = (await addTask(ws.human, { title: "Pull the Q2 numbers", status: "todo" })).created[0]!;
    await claimTask(claude.ctx, { taskId: task.id });
    await handOffTask(claude.ctx, { taskId: task.id, toAgent: "Scout", note: "Slides 1-5" });
    await claimTask(ws.scout.ctx, { taskId: task.id });
    await claimTask(worker.ctx, { taskId: other.id });
    await handOffTask(worker.ctx, { taskId: other.id, toAgent: "Closer" });
    // A handoff Scout made to Claude stays Scout's to hear about.
    const scouts = (await addTask(ws.human, { title: "Scout's errand", status: "todo" })).created[0]!;
    await claimTask(ws.scout.ctx, { taskId: scouts.id });
    await handOffTask(ws.scout.ctx, { taskId: scouts.id, toAgent: "Claude" });
    await claimTask(claude.ctx, { taskId: scouts.id });

    await transferClaims(miaCtx, { fromAgentId: claude.id, toAgentId: content.id });
    expect(await view()).toMatchObject({ claimedByAgentId: ws.scout.agentId, handedOffBy: { kind: "agent", id: content.id, name: "Claude Content Agent" } });
    expect(await view(other.id)).toMatchObject({ claimedByAgentId: content.id, delegation: "handing_off", handedOffByAgentId: content.id });
    expect(await view(scouts.id)).toMatchObject({ claimedByAgentId: content.id, handedOffByAgentId: ws.scout.agentId });
    expect(await lastEvent(task.id)).toMatchObject({ action: "task.updated", actorId: mia.id, data: { changed: ["handedOffByAgentId"] } });

    const follows = await testDb.db.select({ id: watches.entityId, reason: watches.reason }).from(watches).where(and(eq(watches.agentId, content.id), eq(watches.entityType, "task")));
    expect(follows.filter((row) => row.reason === "handoff").map((row) => row.id).sort()).toEqual([task.id, other.id].sort());
    // Scout and Claude keep their own follows: nothing is downgraded or taken away.
    const kept = await testDb.db.select({ agentId: watches.agentId, id: watches.entityId, reason: watches.reason }).from(watches).where(eq(watches.reason, "handoff"));
    expect(kept).toEqual(expect.arrayContaining([
      { agentId: claude.id, id: task.id, reason: "handoff" },
      { agentId: worker.id, id: other.id, reason: "handoff" },
      { agentId: ws.scout.agentId, id: scouts.id, reason: "handoff" },
    ]));
    // Scout's hand-back lands with the new agent.
    expect(await handOffTask(ws.scout.ctx, { taskId: task.id, handBack: true, note: "Slides done" })).toMatchObject({ delegateToAgentId: content.id });
  });

  it("is a call for the person who approved both, or an owner or admin, and never for an agent", async () => {
    await claimTask(claude.ctx, { taskId: task.id });
    const lee = await seedUser(testDb.db, "Lee");
    await addMember(testDb.db, ws.tenant, lee, "member");
    const leeCtx = asUser(testDb.db, ws.tenant, lee, "member");
    const leesAgent = await approved(leeCtx, "Lee's agent");

    await expect(transferClaims(leeCtx, { fromAgentId: claude.id, toAgentId: leesAgent.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(transferClaims(miaCtx, { fromAgentId: claude.id, toAgentId: leesAgent.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(transferClaims(claude.ctx, { fromAgentId: claude.id, toAgentId: content.id })).rejects.toMatchObject({ code: "forbidden" });
    const admin = await approved(ws.human, "Owner's admin agent", "admin");
    await expect(transferClaims(admin.ctx, { fromAgentId: claude.id, toAgentId: content.id })).rejects.toMatchObject({ code: "forbidden" });
    expect(await view()).toMatchObject({ claimedByAgentId: claude.id });

    // An owner manages agents, so may move anyone's work.
    await expect(transferClaims(ws.human, { fromAgentId: claude.id, toAgentId: leesAgent.id })).resolves.toMatchObject({ moved: [{ id: task.id }] });
  });

  it("refuses moving work to itself, to a revoked agent, to or from a sub-agent, or between unknown agents", async () => {
    const worker = await subagentOf(claude.ctx, "Deck writer");
    const gone = await approved(miaCtx, "Gone");
    await revokeAgent(miaCtx, { agentId: gone.id });
    await expect(transferClaims(miaCtx, { fromAgentId: claude.id, toAgentId: claude.id })).rejects.toMatchObject({ code: "invalid" });
    await expect(transferClaims(miaCtx, { fromAgentId: claude.id, toAgentId: gone.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(transferClaims(ws.human, { fromAgentId: worker.id, toAgentId: content.id })).rejects.toMatchObject({ code: "invalid" });
    await expect(transferClaims(ws.human, { fromAgentId: content.id, toAgentId: worker.id })).rejects.toMatchObject({ code: "invalid" });
    await expect(transferClaims(miaCtx, { fromAgentId: "ag_nope", toAgentId: content.id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("takes over a revoked agent's leftover claims", async () => {
    await claimTask(claude.ctx, { taskId: task.id });
    await revokeAgent(miaCtx, { agentId: claude.id });
    await transferClaims(miaCtx, { fromAgentId: claude.id, toAgentId: content.id });
    expect(await view()).toMatchObject({ claimedByAgentId: content.id });
  });
});
