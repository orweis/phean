import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { isoDayFromToday } from "@/lib/dates";
import { TIMELINE_AHEAD_DAYS, TIMELINE_MIN_DAYS } from "@/lib/timeline";
import type { Ctx } from "@/server/domain/context";
import { listActivity } from "@/server/domain/events";
import { createGoal, findGoal, listGoals, setGoalStatus, updateGoal } from "@/server/domain/goals";
import { forget, recall, remember } from "@/server/domain/memory";
import {
  getAgentWorkload,
  getBoard,
  getGoalDetail,
  getJourneys,
  getStatusSummary,
  getTimeline,
  getWorkspaceStats,
} from "@/server/domain/overview";
import { search } from "@/server/domain/search";
import {
  addTask,
  answerInput,
  assignTasksToGoal,
  captureTasks,
  claimTask,
  completeTask,
  linkSession,
  listTasks,
  releaseTask,
  requestInput,
  resolveInput,
  suggestNextActions,
  updateTask,
} from "@/server/domain/tasks";

import { createTestDb, seedTenant, seedWorkspace, type TestDb, type Workspace } from "./support/db";

let testDb: TestDb;
let ws: Workspace;
let human: Ctx;
let scout: Ctx;
let closer: Ctx;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  ws = await seedWorkspace(testDb.db);
  ({ human } = ws);
  scout = ws.scout.ctx;
  closer = ws.closer.ctx;
});

afterAll(() => testDb.close());

const actionsOf = async (ctx: Ctx, entityId: string) =>
  (await listActivity(ctx, {})).filter((event) => event.entityId === entityId).map((event) => event.action);

describe("goals", () => {
  it("approves goals written by humans and only lets agents propose", async () => {
    const mine = await createGoal(human, { title: "Close Q3 books" });
    expect(mine).toMatchObject({ status: "active", approvedByName: "Dana", createdByType: "user" });

    const proposed = await createGoal(scout, { title: "Renew vendor contracts" });
    expect(proposed).toMatchObject({ status: "proposed", approvedAt: null, createdByName: "Scout" });
  });

  it("reserves approving, achieving, and abandoning goals for humans", async () => {
    const goal = await createGoal(scout, { title: "Plan offsite" });
    await expect(setGoalStatus(scout, { goalId: goal.id, status: "active" })).rejects.toMatchObject({
      code: "forbidden",
    });

    const approved = await setGoalStatus(human, { goalId: goal.id, status: "active" });
    expect(approved).toMatchObject({ status: "active", approvedByName: "Dana" });

    const [latest] = await listActivity(human, { limit: 1 });
    expect(latest).toMatchObject({ action: "goal.approved", actorName: "Dana", entityId: goal.id });
  });

  it("logs each status decision once, and keeps the first approval when a goal comes back", async () => {
    const goal = await createGoal(scout, { title: "Migrate payroll" });
    const approved = await setGoalStatus(human, { goalId: goal.id, status: "active" });
    await setGoalStatus(human, { goalId: goal.id, status: "achieved" });
    await setGoalStatus(human, { goalId: goal.id, status: "achieved" });
    await setGoalStatus(human, { goalId: goal.id, status: "abandoned" });
    const back = await setGoalStatus(human, { goalId: goal.id, status: "active" });

    expect(back).toMatchObject({ status: "active", approvedAt: approved.approvedAt });
    expect((await actionsOf(human, goal.id)).reverse()).toEqual([
      "goal.proposed",
      "goal.approved",
      "goal.achieved",
      "goal.abandoned",
      "goal.reactivated",
    ]);
  });

  it("enforces the nesting depth limit and rejects cycles", async () => {
    const root = await createGoal(human, { title: "Level 1" });
    const level2 = await createGoal(human, { title: "Level 2", parentGoalId: root.id });
    const level3 = await createGoal(human, { title: "Level 3", parentGoalId: level2.id });
    const level4 = await createGoal(human, { title: "Level 4", parentGoalId: level3.id });

    await expect(createGoal(human, { title: "Level 5", parentGoalId: level4.id })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(updateGoal(human, { goalId: root.id, parentGoalId: level3.id })).rejects.toMatchObject({
      code: "conflict",
    });

    const loose = await createGoal(human, { title: "Two-level branch" });
    await createGoal(human, { title: "Its child", parentGoalId: loose.id });
    // Moving a two-level subtree under level 3 would make it five deep.
    await expect(updateGoal(human, { goalId: loose.id, parentGoalId: level3.id })).rejects.toMatchObject({
      code: "invalid",
    });
    const moved = await updateGoal(human, { goalId: loose.id, parentGoalId: level2.id });
    expect(moved.parentId).toBe(level2.id);
    const unnested = await updateGoal(human, { goalId: loose.id, parentGoalId: null });
    expect(unnested.parentId).toBeNull();
  });

  it("rejects an edit that changes nothing", async () => {
    const goal = await createGoal(human, { title: "Tidy the wiki" });
    await expect(updateGoal(human, { goalId: goal.id })).rejects.toMatchObject({ code: "invalid" });
  });

  it("rolls task progress up the hierarchy", async () => {
    const parent = await createGoal(human, { title: "Launch website" });
    const child = await createGoal(human, { title: "Write copy", parentGoalId: parent.id });
    const { created } = await captureTasks(human, {
      tasks: [
        { title: "Draft homepage", goalId: child.id, status: "todo" },
        { title: "Draft pricing page", goalId: child.id, status: "todo" },
        { title: "Pick a domain", goalId: parent.id, status: "todo" },
      ],
    });
    await completeTask(human, { taskId: created[0]!.id });

    const goalsById = new Map((await listGoals(human, {})).map((goal) => [goal.id, goal]));
    expect(goalsById.get(child.id)).toMatchObject({ depth: 1, progress: 0.5, own: { open: 1, done: 1, total: 2 } });
    expect(goalsById.get(parent.id)).toMatchObject({ depth: 0, childCount: 1, rollup: { open: 2, done: 1, total: 3 } });
    expect(goalsById.get(parent.id)!.progress).toBeCloseTo(1 / 3);
  });
});

describe("tasks", () => {
  it("skips duplicates when several agents capture the same source item", async () => {
    const first = await captureTasks(scout, {
      tasks: [
        { title: "Reply to auditor", source: "email", sourceRef: "msg-1" },
        { title: "Book flights", source: "email", sourceRef: "msg-2" },
      ],
    });
    expect(first.created).toHaveLength(2);

    const second = await captureTasks(closer, {
      tasks: [
        { title: "Reply to the auditor", source: "email", sourceRef: "msg-1" },
        { title: "Prepare board deck", source: "slack", sourceRef: "C1/p1" },
      ],
    });
    expect(second.created.map((task) => task.title)).toEqual(["Prepare board deck"]);
    expect(second.duplicates).toEqual([
      expect.objectContaining({ sourceRef: "msg-1", existingTaskId: first.created[0]!.id }),
    ]);
  });

  it("adds one task by hand through the same capture path", async () => {
    const goal = await createGoal(human, { title: "Taxes" });
    const added = await addTask(human, { title: "File the extension", goalId: goal.id, status: "todo", source: "email", sourceRef: "msg-9" });
    expect(added.created).toEqual([expect.objectContaining({ title: "File the extension", goalId: goal.id, createdByName: "Dana" })]);
    expect(await actionsOf(human, added.created[0]!.id)).toEqual(["task.captured"]);

    const again = await addTask(human, { title: "File it", source: "email", sourceRef: "msg-9" });
    expect(again).toEqual({ created: [], duplicates: [expect.objectContaining({ existingTaskId: added.created[0]!.id })] });
    await expect(addTask(human, { title: "  " })).rejects.toMatchObject({ code: "invalid" });
  });

  it("lets exactly one agent claim a task and protects claimed work", async () => {
    const {
      created: [task],
    } = await captureTasks(human, { tasks: [{ title: "Send invoice reminders", status: "todo" }] });

    const results = await Promise.allSettled([claimTask(scout, { taskId: task!.id }), claimTask(closer, { taskId: task!.id })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const claimed = (await listTasks(human, { claimed: "any" })).find((candidate) => candidate.id === task!.id)!;
    const [holder, other] = claimed.claimedByName === "Scout" ? [scout, closer] : [closer, scout];
    expect(claimed).toMatchObject({ status: "in_progress", claimedByName: holder.actor.name });

    await expect(completeTask(other, { taskId: task!.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(releaseTask(other, { taskId: task!.id })).rejects.toMatchObject({ code: "conflict" });
    expect(await suggestNextActions(other, { limit: 20 })).not.toContainEqual(expect.objectContaining({ id: task!.id }));
    expect((await listTasks(holder, { claimed: "mine" })).map((mine) => mine.id)).toEqual([task!.id]);
    expect(await listTasks(human, { claimed: "mine" })).toEqual([]);

    const done = await completeTask(holder, { taskId: task!.id, note: "Sent 4 reminders" });
    expect(done).toMatchObject({ status: "done", claimedByAgentId: null });
    expect(done.description).toContain(`Completion note (${holder.actor.name}): Sent 4 reminders`);
  });

  it("completes a task once, so a retry neither fails nor logs again", async () => {
    const {
      created: [task],
    } = await captureTasks(scout, { tasks: [{ title: "Pay the cloud bill", status: "todo" }] });
    const first = await completeTask(scout, { taskId: task!.id, note: "Paid" });
    const retry = await completeTask(scout, { taskId: task!.id, note: "Paid" });

    expect(retry).toEqual(first);
    expect(await actionsOf(human, task!.id)).toEqual(["task.completed", "task.captured"]);
    await expect(claimTask(scout, { taskId: task!.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("lets humans step in on claimed tasks and agents release their own", async () => {
    const {
      created: [task],
    } = await captureTasks(human, { tasks: [{ title: "Renew domain", status: "todo" }] });
    await expect(claimTask(human, { taskId: task!.id })).rejects.toMatchObject({ code: "invalid" });
    await claimTask(scout, { taskId: task!.id });

    const released = await releaseTask(scout, { taskId: task!.id });
    expect(released).toMatchObject({ status: "todo", claimedByAgentId: null });

    await claimTask(scout, { taskId: task!.id });
    const dropped = await updateTask(human, { taskId: task!.id, status: "dropped" });
    expect(dropped).toMatchObject({ status: "dropped", claimedByAgentId: null });
    await expect(claimTask(closer, { taskId: task!.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("clears a due date and unfiles a task with null, and rejects an edit that changes nothing", async () => {
    const goal = await createGoal(human, { title: "Errands" });
    const {
      created: [task],
    } = await captureTasks(human, { tasks: [{ title: "Return the parcel", goalId: goal.id, dueDate: isoDayFromToday(1) }] });

    const cleared = await updateTask(human, { taskId: task!.id, dueDate: null, goalId: null });
    expect(cleared).toMatchObject({ dueDate: null, goalId: null, title: "Return the parcel" });
    await expect(updateTask(human, { taskId: task!.id })).rejects.toMatchObject({ code: "invalid" });
  });

  it("triages inbox items when filing them under a goal", async () => {
    const goal = await createGoal(human, { title: "Hiring" });
    const { created } = await captureTasks(scout, {
      tasks: [{ title: "Screen candidate A" }, { title: "Screen candidate B", status: "todo" }],
    });
    const filed = await assignTasksToGoal(scout, { taskIds: created.map((task) => task.id), goalId: goal.id });
    expect(filed.map((task) => [task.status, task.goalId])).toEqual([
      ["todo", goal.id],
      ["todo", goal.id],
    ]);
    await expect(assignTasksToGoal(scout, { taskIds: ["t_missing"], goalId: goal.id })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("filters by due date and orders by urgency", async () => {
    await captureTasks(human, {
      tasks: [
        { title: "Overdue filing", dueDate: "2001-01-01", priority: "low", status: "todo" },
        { title: "Urgent and due soon", dueDate: isoDayFromToday(2), priority: "urgent", status: "todo" },
        { title: "Due next month", dueDate: isoDayFromToday(30), status: "todo" },
      ],
    });
    const overdue = await listTasks(human, { due: "overdue" });
    expect(overdue.map((task) => task.title)).toEqual(["Overdue filing"]);

    const soon = await listTasks(human, { due: "next_7_days" });
    expect(soon.map((task) => task.title)).toEqual(["Urgent and due soon"]);

    const [first] = await suggestNextActions(human, { limit: 1 });
    expect(first?.title).toBe("Urgent and due soon");
  });

  it("validates input at the service boundary", async () => {
    await expect(captureTasks(human, { tasks: [] })).rejects.toMatchObject({ code: "invalid" });
    await expect(
      captureTasks(human, { tasks: [{ title: "Bad date", dueDate: "next tuesday" }] }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(updateTask(human, { taskId: "t_whatever", title: "x" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("agent sessions and questions", () => {
  const todo = async (title: string) => (await captureTasks(human, { tasks: [{ title, status: "todo" }] })).created[0]!;
  const chat = (id: string) => ({ url: `https://claude.ai/chat/${id}`, app: "Claude", brief: "Comparing the two quotes" });

  it("keeps one session per agent, newest first, and logs only a new place to resume", async () => {
    const task = await todo("Pick a payroll provider");
    const claimed = await claimTask(scout, { taskId: task.id, session: chat("a1") });
    expect(claimed.agentSessions).toEqual([
      expect.objectContaining({ agentName: "Scout", url: "https://claude.ai/chat/a1", app: "Claude", sessionId: null, brief: "Comparing the two quotes" }),
    ]);

    await linkSession(scout, { taskId: task.id, session: { ...chat("a1"), messageId: "m7", brief: "Waiting on the second quote" } });
    await releaseTask(scout, { taskId: task.id });
    const both = await linkSession(closer, { taskId: task.id, session: { sessionId: "f3e1", command: "claude --resume f3e1" } });
    expect(both.agentSessions.map((session) => [session.agentName, session.messageId ?? session.command])).toEqual([
      ["Closer", "claude --resume f3e1"],
      ["Scout", "m7"],
    ]);
    expect(await actionsOf(human, task.id)).toEqual(["task.session_linked", "task.released", "task.claimed", "task.captured"]);

    const moved = await linkSession(scout, { taskId: task.id, session: chat("b2") });
    expect(moved.agentSessions.map((session) => session.url)).toEqual(["https://claude.ai/chat/b2", null]);
  });

  it("accepts web and app links only, and needs a way back to the session", async () => {
    const task = await todo("Draft the launch post");
    for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "/w/acme", "not a link"]) {
      await expect(linkSession(scout, { taskId: task.id, session: { url } }), url).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(linkSession(scout, { taskId: task.id, session: { brief: "Somewhere" } })).rejects.toMatchObject({ code: "invalid" });

    const app = await linkSession(scout, { taskId: task.id, session: { url: "cursor://anysphere.cursor-deeplink/chat?id=9", app: "Cursor" } });
    expect(app.agentSessions[0]?.url).toBe("cursor://anysphere.cursor-deeplink/chat?id=9");
    await expect(linkSession(human, { taskId: task.id, session: chat("h") })).rejects.toMatchObject({ code: "invalid" });
  });

  it("shows a question as waiting on people until it is answered, and appends the answer", async () => {
    const task = await todo("Settle the Globex invoice dispute");
    await claimTask(scout, { taskId: task.id });
    const asked = await requestInput(scout, { taskId: task.id, question: "Offer a 5% discount, or escalate to their CFO?", session: chat("q1") });
    expect(asked.inputRequest).toMatchObject({ agentName: "Scout", question: "Offer a 5% discount, or escalate to their CFO?" });
    expect(asked.agentSessions[0]?.url).toBe("https://claude.ai/chat/q1");

    const summary = await getStatusSummary(human, {});
    expect(summary).toMatchObject({ awaitingInput: 1, waitingOnYou: 1 });
    expect(summary.awaitingInputTasks.map((waiting) => waiting.id)).toEqual([task.id]);
    expect(await suggestNextActions(scout, { limit: 20 })).not.toContainEqual(expect.objectContaining({ id: task.id }));

    await expect(requestInput(closer, { taskId: task.id, question: "Also, which bank?" })).rejects.toMatchObject({ code: "conflict" });
    await expect(answerInput(scout, { taskId: task.id, answer: "Escalate" })).rejects.toMatchObject({ code: "invalid" });

    const answered = await answerInput(human, { taskId: task.id, answer: "Escalate to their CFO." });
    expect(answered).toMatchObject({ inputRequest: null, status: "in_progress", claimedByAgentId: ws.scout.agentId });
    expect(answered.description).toBe("Question from Scout: Offer a 5% discount, or escalate to their CFO?\nAnswer from Dana: Escalate to their CFO.");
    expect((await getStatusSummary(human, {})).awaitingInput).toBe(0);

    const [event] = await listActivity(scout, { limit: 1 });
    expect(event).toMatchObject({ action: "task.input_answered", actorName: "Dana", data: expect.objectContaining({ answer: "Escalate to their CFO." }) });
    await expect(answerInput(human, { taskId: task.id, answer: "Too late" })).rejects.toMatchObject({ code: "conflict" });
    await expect(answerInput(human, { taskId: task.id })).resolves.toMatchObject({ inputRequest: null });
  });

  it("closes a question when its agent resolves it or the work stops", async () => {
    const task = await todo("Book the offsite venue");
    await requestInput(scout, { taskId: task.id, question: "Lisbon or Porto?" });
    await expect(resolveInput(closer, { taskId: task.id })).rejects.toMatchObject({ code: "conflict" });
    expect((await resolveInput(scout, { taskId: task.id })).inputRequest).toBeNull();
    expect((await resolveInput(scout, { taskId: task.id })).inputRequest).toBeNull();

    const ask = () => requestInput(scout, { taskId: task.id, question: "Lisbon or Porto?" });
    await claimTask(scout, { taskId: task.id });
    await ask();
    expect((await releaseTask(scout, { taskId: task.id })).inputRequest).toBeNull();
    await ask();
    expect((await updateTask(human, { taskId: task.id, status: "in_progress" })).inputRequest).not.toBeNull();
    expect((await updateTask(human, { taskId: task.id, status: "todo" })).inputRequest).toBeNull();
    await ask();
    expect((await completeTask(scout, { taskId: task.id, note: "Booked Porto" })).inputRequest).toBeNull();
    await expect(ask()).rejects.toMatchObject({ code: "conflict" });
    expect((await getStatusSummary(human, {})).awaitingInput).toBe(0);
    expect(await actionsOf(human, task.id)).toEqual(expect.arrayContaining(["task.input_requested", "task.input_resolved"]));
  });

  it("keeps agents off questions and sessions on work another agent holds", async () => {
    const task = await todo("Renew the SSL certificate");
    await claimTask(scout, { taskId: task.id, session: chat("s1") });
    await expect(linkSession(closer, { taskId: task.id, session: chat("c1") })).rejects.toMatchObject({ code: "conflict" });
    await expect(requestInput(closer, { taskId: task.id, question: "Which CA?" })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("memory and search", () => {
  it("recalls by prefix and only lets agents forget their own memories", async () => {
    const preference = await remember(scout, { content: "Dana prefers invoices batched on Fridays", kind: "preference" });
    const fact = await remember(human, { content: "The auditor is Rivera & Co.", kind: "fact" });

    expect((await recall(closer, { query: "invoic" })).map((memory) => memory.id)).toEqual([preference.id]);
    expect((await recall(closer, { kind: "fact" })).map((memory) => memory.id)).toEqual([fact.id]);

    await expect(forget(closer, { memoryId: preference.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(forget(scout, { memoryId: preference.id })).resolves.toEqual({ forgotten: preference.id });
    await expect(forget(human, { memoryId: fact.id })).resolves.toEqual({ forgotten: fact.id });
    expect(await recall(closer, {})).toEqual([]);
  });

  it("searches goals, tasks, and memories together with prefix matching", async () => {
    const hiring = await createGoal(human, { title: "Hiring" });
    await captureTasks(scout, { tasks: [{ title: "Reply to auditor", goalId: hiring.id }] });
    await remember(scout, { content: "Auditors want the ledger export as CSV" });

    const hits = await search(human, { query: "audit" });
    expect(hits.map((hit) => [hit.kind, hit.title, hit.goalId]).sort()).toEqual([
      ["memory", "Auditors want the ledger export as CSV", null],
      ["task", "Reply to auditor", hiring.id],
    ]);

    const onlyGoals = await search(human, { query: "hiring", kinds: ["goal"] });
    expect(onlyGoals.map((hit) => [hit.title, hit.status])).toEqual([["Hiring", "active"]]);
    await expect(search(human, { query: "!!!" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("titles a memory hit with its opening words", async () => {
    const content = `Quarterly close checklist: ${"reconcile accounts, ".repeat(6)}then lock the period.`;
    await remember(human, { content });
    const [hit] = await search(human, { query: "checklist" });
    expect(hit).toMatchObject({ kind: "memory", status: "note", snippet: content });
    expect(hit!.title).toHaveLength(80);
    expect(hit!.title.endsWith("…")).toBe(true);
    expect(content.startsWith(hit!.title.slice(0, -1))).toBe(true);
  });
});

describe("read models", () => {
  it("summarizes workspace status", async () => {
    await createGoal(scout, { title: "Renew vendor contracts" });
    await captureTasks(human, {
      tasks: [
        { title: "Overdue filing", dueDate: "2001-01-01", status: "todo" },
        { title: "Due this week", dueDate: isoDayFromToday(3), status: "todo" },
        { title: "Untriaged" },
      ],
    });

    const summary = await getStatusSummary(scout, {});
    expect(summary).toMatchObject({
      workspace: ws.tenant,
      agents: 2,
      activeAgents: 2,
      openTasks: 3,
      inbox: 1,
      overdue: 1,
      dueThisWeek: 1,
      activeGoals: 0,
      pendingApprovals: 1,
      goalsByStatus: { proposed: 1, active: 0, achieved: 0, abandoned: 0 },
      tasksByStatus: { inbox: 1, todo: 2, in_progress: 0, done: 0, dropped: 0 },
    });
    expect(summary.overdueTasks.map((task) => task.title)).toEqual(["Overdue filing"]);
    expect(summary.dueSoonTasks.map((task) => task.title)).toEqual(["Due this week"]);
    expect(summary.lastActivityAt).toBeInstanceOf(Date);
  });

  it("counts many workspaces at once and gives an untouched one zeros", async () => {
    await captureTasks(human, { tasks: [{ title: "Only in this workspace" }] });
    const quiet = await seedTenant(testDb.db, `quiet-${ws.tenant.slug}`);

    const stats = await getWorkspaceStats(testDb.db, [ws.tenant.id, quiet.id, ws.tenant.id]);
    expect([...stats.keys()]).toEqual([ws.tenant.id, quiet.id]);
    expect(stats.get(ws.tenant.id)).toMatchObject({ openTasks: 1, inbox: 1, agents: 2 });
    expect(stats.get(quiet.id)).toEqual({
      tasksByStatus: { inbox: 0, todo: 0, in_progress: 0, done: 0, dropped: 0 },
      goalsByStatus: { proposed: 0, active: 0, achieved: 0, abandoned: 0 },
      openTasks: 0,
      inbox: 0,
      overdue: 0,
      dueThisWeek: 0,
      doneLast7Days: 0,
      activeGoals: 0,
      pendingApprovals: 0,
      awaitingInput: 0,
      waitingOnYou: 0,
      agents: 0,
      activeAgents: 0,
      lastActivityAt: null,
    });
    expect(await getWorkspaceStats(testDb.db, [])).toEqual(new Map());
  });

  it("assembles goal detail with ancestors, sub-goals, tasks, memories, and activity", async () => {
    const parent = await createGoal(human, { title: "Fundraise" });
    const goal = await createGoal(human, { title: "Data room", parentGoalId: parent.id });
    const child = await createGoal(scout, { title: "Collect contracts", parentGoalId: goal.id });
    const { created } = await captureTasks(scout, { tasks: [{ title: "Upload cap table", goalId: goal.id }] });
    await remember(scout, { content: "Investors asked for monthly metrics", goalId: goal.id });

    const detail = await getGoalDetail(human, { goalId: goal.id });
    expect(detail.ancestors.map((ancestor) => ancestor.title)).toEqual(["Fundraise"]);
    expect(detail.children.map((sub) => sub.id)).toEqual([child.id]);
    expect(detail.tasks.map((task) => [task.id, task.goalTitle])).toEqual([[created[0]!.id, "Data room"]]);
    expect(detail.memories).toHaveLength(1);
    expect(detail.activity.map((event) => event.action)).toEqual(
      expect.arrayContaining(["goal.created", "task.captured", "memory.saved"]),
    );
    await expect(getGoalDetail(human, { goalId: "g_missing" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("builds a board scoped to a goal and its sub-goals", async () => {
    const goal = await createGoal(human, { title: "Office move" });
    const sub = await createGoal(human, { title: "Furniture", parentGoalId: goal.id });
    const { created } = await captureTasks(human, {
      tasks: [
        { title: "Sign lease", goalId: goal.id, status: "todo" },
        { title: "Order desks", goalId: sub.id, status: "todo" },
        { title: "Elsewhere", status: "todo" },
      ],
    });
    await completeTask(human, { taskId: created[0]!.id });

    const board = await getBoard(human, { goalId: goal.id });
    const titles = Object.fromEntries(board.columns.map((column) => [column.status, column.tasks.map((task) => task.title)]));
    expect(titles).toEqual({ inbox: [], todo: ["Order desks"], in_progress: [], done: ["Sign lease"] });
    await expect(getBoard(human, { goalId: "g_missing" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists dated work soonest first and leaves out dropped tasks", async () => {
    const { created } = await captureTasks(human, {
      tasks: [
        { title: "Later", dueDate: isoDayFromToday(9) },
        { title: "Undated" },
        { title: "Sooner", dueDate: isoDayFromToday(2) },
        { title: "Abandoned", dueDate: isoDayFromToday(1) },
      ],
    });
    await updateTask(human, { taskId: created[3]!.id, status: "dropped" });
    expect((await getTimeline(human, {})).map((task) => task.title)).toEqual(["Sooner", "Later"]);
  });

  it("filters activity by time and by goal", async () => {
    const before = new Date().toISOString();
    const goal = await createGoal(scout, { title: "Quarterly review" });
    await captureTasks(scout, { tasks: [{ title: "Collect KPIs", goalId: goal.id }] });

    const recent = await listActivity(closer, { since: before });
    expect(recent.map((event) => event.action)).toEqual(["task.captured", "goal.proposed"]);
    expect(recent.every((event) => event.actorName === "Scout")).toBe(true);

    const forGoal = await listActivity(closer, { goalId: goal.id });
    expect(forGoal).toHaveLength(2);
    expect((await findGoal(closer, goal.id)).status).toBe("proposed");
  });

  it("replays each task's journey from the activity log", async () => {
    const goal = await createGoal(human, { title: "Website refresh" });
    const sub = await createGoal(human, { title: "Copy", parentGoalId: goal.id });
    const { created } = await captureTasks(scout, {
      tasks: [
        { title: "Rewrite the pricing page", goalId: sub.id },
        { title: "Pick a hero photo", goalId: goal.id, status: "todo" },
      ],
    });
    const [pricing, photo] = created;
    await updateTask(human, { taskId: pricing!.id, status: "todo" });
    await claimTask(closer, { taskId: pricing!.id });
    await completeTask(closer, { taskId: pricing!.id });
    await updateTask(human, { taskId: photo!.id, status: "dropped" });

    const { journeys, window, truncated } = await getJourneys(human, { goalId: goal.id, days: 14 });
    expect(truncated).toBe(false);
    // Both tasks were captured today, so the 14-day window is fitted down to the shortest one.
    expect(window.days).toHaveLength(TIMELINE_MIN_DAYS + TIMELINE_AHEAD_DAYS);
    const stops = Object.fromEntries(journeys.map(({ task, stops }) => [task.title, stops.map((stop) => stop.status)]));
    expect(stops).toEqual({
      "Rewrite the pricing page": ["inbox", "todo", "in_progress", "done"],
      "Pick a hero photo": ["todo", "dropped"],
    });
    await expect(getJourneys(human, { days: 7 as 14 })).rejects.toMatchObject({ code: "invalid" });
  });

  it("reports each agent's workload, busiest first", async () => {
    const { created } = await captureTasks(human, {
      tasks: [
        { title: "Book the movers", status: "todo" },
        { title: "Cancel the lease", status: "todo" },
        { title: "Forward the mail", status: "todo" },
      ],
    });
    await claimTask(scout, { taskId: created[0]!.id });
    await claimTask(closer, { taskId: created[1]!.id });
    await completeTask(closer, { taskId: created[1]!.id });
    await claimTask(closer, { taskId: created[2]!.id });

    const workload = await getAgentWorkload(human, {});
    expect(workload.map((load) => [load.agent.name, load.claimed, load.completedLast7Days])).toEqual([
      ["Closer", 1, 1],
      ["Scout", 1, 0],
    ]);
  });
});
