import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentContext, authenticateAgentToken, createAgent, createSubagent, resolveNamedSubagent, revokeAgent } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";
import { listActivity } from "@/server/domain/events";
import { browseTasks, getBoard } from "@/server/domain/overview";
import {
  addTask,
  cancelHandOff,
  claimTask,
  completeTask,
  getTask,
  handOffTask,
  linkSession,
  listHandoffs,
  listTasks,
  releaseTask,
  requestInput,
  suggestNextActions,
  takeTask,
  updateTask,
  type Task,
} from "@/server/domain/tasks";
import { reasonsFor } from "@/server/webhooks/routing";

import { addMember, asUser, createTestDb, seedUser, seedWorkspace, type TestDb, type TestUser, type Workspace } from "./support/db";

let testDb: TestDb;
let ws: Workspace;
let human: Ctx;
let scout: Ctx;
let closer: Ctx;
let lee: TestUser;
let leeCtx: Ctx;
let task: Task;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  ws = await seedWorkspace(testDb.db);
  ({ human } = ws);
  scout = ws.scout.ctx;
  closer = ws.closer.ctx;
  lee = await seedUser(testDb.db, "Lee");
  await addMember(testDb.db, ws.tenant, lee, "member");
  leeCtx = asUser(testDb.db, ws.tenant, lee, "member");
  const { created } = await addTask(human, { title: "Draft the launch post", status: "todo" });
  task = created[0]!;
});

const view = async (ctx: Ctx, taskId = task.id) => (await getTask(ctx, { taskId })).task;

describe("operators", () => {
  it("names the agent that claimed a task, or the person who took it, as its operator", async () => {
    await claimTask(scout, { taskId: task.id });
    expect(await view(human)).toMatchObject({ operatorType: "agent", operatorName: "Scout", delegation: null });

    await takeTask(leeCtx, { taskId: task.id });
    expect(await view(human)).toMatchObject({ operatorType: "user", operatorName: "Lee", claimedByAgentId: null, operatorUserId: lee.id, status: "in_progress" });
  });

  it("keeps agents off a task a person is working on, as off another agent's claim", async () => {
    await takeTask(leeCtx, { taskId: task.id });
    await expect(claimTask(scout, { taskId: task.id })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("being worked on by Lee") });
    await expect(completeTask(scout, { taskId: task.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(updateTask(scout, { taskId: task.id, status: "todo" })).rejects.toMatchObject({ code: "conflict" });
    // The person working on it, and any other person, may still move it.
    await completeTask(leeCtx, { taskId: task.id, note: "Posted" });
    expect(await view(human)).toMatchObject({ status: "done", operatorType: null, delegation: null });
  });

  it("only lets agents claim and only lets people take", async () => {
    await expect(takeTask(scout, { taskId: task.id })).rejects.toMatchObject({ code: "invalid" });
    await expect(claimTask(human, { taskId: task.id })).rejects.toMatchObject({ code: "invalid" });
  });

  it("lists a person's own work with claimed mine, and splits it into the People row", async () => {
    await takeTask(leeCtx, { taskId: task.id });
    expect((await listTasks(leeCtx, { claimed: "mine" })).map((row) => row.id)).toEqual([task.id]);
    expect(await listTasks(human, { claimed: "mine" })).toEqual([]);
    expect(await listTasks(human, { claimed: "unclaimed" })).toEqual([]);
    const board = await getBoard(human, {});
    const lane = board.columns.find((column) => column.stage.key === "in_progress")!;
    expect(lane.tasks.map((row) => [row.id, row.operatorName])).toEqual([[task.id, "Lee"]]);
  });
});

describe("handing off", () => {
  it("passes a task to a named agent, which picks it up with the note, and its first step ends the pick-up", async () => {
    await claimTask(scout, { taskId: task.id });
    await handOffTask(scout, { taskId: task.id, toAgent: "closer", note: "Outline is in the doc; needs the pricing section." });
    // Still Scout's until Closer takes it, so it is never orphaned.
    expect(await view(human)).toMatchObject({ operatorName: "Scout", delegation: "handing_off", delegateToName: "Closer", delegationNote: "Outline is in the doc; needs the pricing section." });
    expect((await listTasks(closer, { claimed: "handed_to_me" })).map((row) => row.id)).toEqual([task.id]);
    expect((await suggestNextActions(closer, {}))[0]?.id).toBe(task.id);

    const picked = await claimTask(closer, { taskId: task.id });
    expect(picked).toMatchObject({ claimedByAgentId: ws.closer.agentId, delegation: "picking_up", delegateToAgentId: null, delegationNote: "Outline is in the doc; needs the pricing section." });
    expect(await listTasks(closer, { claimed: "handed_to_me" })).toEqual([]);

    await linkSession(closer, { taskId: task.id, session: { sessionId: "s-2" } });
    expect(await view(human)).toMatchObject({ operatorName: "Closer", delegation: null, delegationNote: "" });

    const actions = (await listActivity(human, {})).map((event) => event.action);
    expect(actions).toEqual(expect.arrayContaining(["task.handed_off", "task.picked_up"]));
  });

  it("refuses a named handoff to anyone else, and lets anyone pick up an open one", async () => {
    await claimTask(scout, { taskId: task.id });
    await handOffTask(scout, { taskId: task.id, toPerson: lee.email });
    await expect(claimTask(closer, { taskId: task.id })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("handed off to Lee") });
    expect((await listTasks(leeCtx, { claimed: "handed_to_me" })).map((row) => row.id)).toEqual([task.id]);

    await handOffTask(scout, { taskId: task.id, note: "Whoever is free" });
    await claimTask(closer, { taskId: task.id });
    expect(await view(human)).toMatchObject({ operatorName: "Closer", delegation: "picking_up" });
  });

  it("lets a person hand an unworked task to an agent, and take one handed to them", async () => {
    await handOffTask(human, { taskId: task.id, toAgent: ws.scout.agentId, note: "Please draft it" });
    expect(await view(human)).toMatchObject({ operatorType: null, delegation: "handing_off", delegateToName: "Scout" });
    await claimTask(scout, { taskId: task.id });

    await handOffTask(scout, { taskId: task.id, toPerson: lee.id, note: "Needs your sign-off on tone" });
    const taken = await takeTask(leeCtx, { taskId: task.id });
    expect(taken).toMatchObject({ operatorUserId: lee.id, claimedByAgentId: null, delegation: "picking_up" });
    // A person's update counts as their first step too.
    await updateTask(leeCtx, { taskId: task.id, priority: "high" });
    expect(await view(human)).toMatchObject({ delegation: null });
  });

  it("refuses handing to yourself, to someone already on it, to strangers, and handing off another's work", async () => {
    await claimTask(scout, { taskId: task.id });
    await expect(handOffTask(scout, { taskId: task.id, toAgent: "Scout" })).rejects.toMatchObject({ code: "invalid" });
    await expect(handOffTask(human, { taskId: task.id, toAgent: "Scout" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("already working") });
    await expect(handOffTask(scout, { taskId: task.id, toAgent: "Nobody" })).rejects.toMatchObject({ code: "not_found" });
    await expect(handOffTask(scout, { taskId: task.id, toPerson: "stranger@example.com" })).rejects.toMatchObject({ code: "not_found" });
    await expect(handOffTask(closer, { taskId: task.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("calls a handoff off, leaving the task with its operator", async () => {
    await claimTask(scout, { taskId: task.id });
    await handOffTask(scout, { taskId: task.id, toAgent: "Closer" });
    await expect(cancelHandOff(closer, { taskId: task.id })).rejects.toMatchObject({ code: "conflict" });
    await cancelHandOff(scout, { taskId: task.id });
    expect(await view(human)).toMatchObject({ operatorName: "Scout", delegation: null, delegateToAgentId: null });
    await expect(claimTask(closer, { taskId: task.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("tells the named agent at once, whatever it watches", () => {
    const event = { id: 1, action: "task.handed_off", entityType: "task", entityId: task.id, data: { toAgentId: ws.closer.agentId } };
    const listener = { agentId: ws.closer.agentId, topics: ["tasks"] as const, scope: "related" as const };
    expect(reasonsFor(event, listener, new Set(), ws.scout.agentId)).toEqual(["handed_to_you"]);
    expect(reasonsFor(event, { ...listener, agentId: ws.scout.agentId }, new Set(), null)).toEqual([]);
  });
});

describe("handing off to a sub-agent", () => {
  /** The context a call with `actingAs` runs in, exactly as the MCP handler builds it. */
  const actingAs = async (token: string, name: string) => {
    const principal = await resolveNamedSubagent(testDb.db, (await authenticateAgentToken(testDb.db, token))!, name);
    if (!principal) throw new Error(`"${name}" was refused`);
    return agentContext(testDb.db, principal);
  };

  it("lets a parent acting as its own-token sub-agent pick up a handoff addressed to that sub-agent", async () => {
    // Scout gives its writer a token of its own; later Scout relays for it with actingAs.
    const { agent: writer } = await createSubagent(scout, { name: "Scout Writer", purpose: "drafts posts" });
    await claimTask(closer, { taskId: task.id });
    await handOffTask(closer, { taskId: task.id, toAgent: "Scout Writer", note: "Draft it" });

    const asWriter = await actingAs(ws.scout.token, "scout writer");
    expect(asWriter.actor.id).toBe(writer.id);
    expect((await listTasks(asWriter, { claimed: "handed_to_me" })).map((row) => row.id)).toEqual([task.id]);
    await claimTask(asWriter, { taskId: task.id });
    expect(await view(human)).toMatchObject({ claimedByAgentId: writer.id, delegation: "picking_up" });
  });

  it("never makes a second sub-agent of the same name, either way round", async () => {
    const first = await actingAs(ws.scout.token, "Helper");
    expect((await actingAs(ws.scout.token, " helper ")).actor.id).toBe(first.actor.id);
    await expect(createSubagent(scout, { name: "HELPER" })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("already has a sub-agent") });
    // Another parent may use the name for its own sub-agent.
    await createSubagent(closer, { name: "Helper" });
  });

  it("keeps a revoked sub-agent's name refused to actingAs", async () => {
    const { agent } = await createSubagent(scout, { name: "Retired" });
    await revokeAgent(scout, { agentId: agent.id });
    expect(await resolveNamedSubagent(testDb.db, (await authenticateAgentToken(testDb.db, ws.scout.token))!, "Retired")).toBeNull();
  });

  it("refuses a handoff by a name two agents share, and takes the id instead", async () => {
    const { agent: one } = await createAgent(human, { name: "Writer" });
    await createAgent(human, { name: "writer" });
    await expect(handOffTask(human, { taskId: task.id, toAgent: "Writer" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("Pass toAgent as the id") });
    expect((await handOffTask(human, { taskId: task.id, toAgent: one.id })).delegateToAgentId).toBe(one.id);
  });
});

describe("handoff status in lists", () => {
  it("lists open handoffs with the viewer's first, then the longest waiting, and filters every layout by them", async () => {
    const { created } = await addTask(human, { title: "Book the venue", status: "todo" });
    const venue = created[0]!;
    await claimTask(scout, { taskId: task.id });
    await handOffTask(scout, { taskId: task.id, toAgent: "Closer", note: "Draft is half done" });
    await claimTask(closer, { taskId: venue.id });
    await releaseTask(closer, { taskId: venue.id, note: "Need a budget first" });

    // Neither is handed to Lee, so Lee sees them longest waiting first.
    expect((await listHandoffs(leeCtx, {})).map((row) => [row.title, row.delegation])).toEqual([
      ["Draft the launch post", "handing_off"],
      ["Book the venue", "returned"],
    ]);
    await handOffTask(human, { taskId: venue.id, toPerson: lee.email, note: "Can you get the budget?" });
    expect((await listHandoffs(leeCtx, {}))[0]?.title).toBe("Book the venue");
    // Closer sees the one handed to it first.
    expect((await listHandoffs(closer, {}))[0]?.id).toBe(task.id);

    const titles = (rows: { title: string }[]) => rows.map((row) => row.title).sort();
    expect(titles((await browseTasks(human, { handoff: "any" })).tasks)).toEqual(["Book the venue", "Draft the launch post"]);
    expect(titles((await browseTasks(human, { handoff: "handing_off" })).tasks)).toEqual(["Book the venue", "Draft the launch post"]);
    expect(titles((await browseTasks(closer, { handoff: "to_me" })).tasks)).toEqual(["Draft the launch post"]);
    expect(titles((await browseTasks(leeCtx, { handoff: "to_me" })).tasks)).toEqual(["Book the venue"]);
    const board = await getBoard(closer, { handoff: "to_me" });
    expect(board.columns.flatMap((column) => column.tasks.map((row) => row.title))).toEqual(["Draft the launch post"]);

    // Once picked up and settled, a task leaves the handoff lists.
    await claimTask(closer, { taskId: task.id });
    await linkSession(closer, { taskId: task.id, session: { sessionId: "s-3" } });
    expect((await listHandoffs(human, {})).map((row) => row.title)).toEqual(["Book the venue"]);
  });
});

describe("returning and taking over", () => {
  it("returns a released task with its note, and the next operator picks it up", async () => {
    await claimTask(scout, { taskId: task.id });
    await releaseTask(scout, { taskId: task.id, note: "Blocked on legal; the draft is attached." });
    expect(await view(human)).toMatchObject({ status: "todo", operatorType: null, delegation: "returned", delegationNote: "Blocked on legal; the draft is attached." });
    await claimTask(closer, { taskId: task.id });
    expect(await view(human)).toMatchObject({ operatorName: "Closer", delegation: "picking_up", delegationNote: "Blocked on legal; the draft is attached." });
  });

  it("lets a person step in for an agent, closing the agent's open question", async () => {
    await claimTask(scout, { taskId: task.id });
    await requestInput(scout, { taskId: task.id, question: "Which tone?", kind: "decision", options: ["Warm", "Crisp"] });
    await takeTask(human, { taskId: task.id });
    expect(await view(human)).toMatchObject({ operatorName: "Dana", delegation: "picking_up", inputRequest: null });
  });

  it("clears the operator and any handover when a task is finished or moved out of progress", async () => {
    await claimTask(scout, { taskId: task.id });
    await handOffTask(scout, { taskId: task.id, toAgent: "Closer" });
    await updateTask(human, { taskId: task.id, status: "dropped" });
    expect(await view(human)).toMatchObject({ operatorType: null, delegation: null, delegateToAgentId: null });
  });
});
