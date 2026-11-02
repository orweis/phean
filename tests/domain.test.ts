import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Ctx } from "@/server/domain/context";
import { listActivity } from "@/server/domain/events";
import { createGoal, findGoal, listGoals, setGoalStatus, updateGoal } from "@/server/domain/goals";
import { forget, recall, remember } from "@/server/domain/memory";
import { getBoard, getGoalDetail, getStatusSummary, getTimeline } from "@/server/domain/overview";
import { search } from "@/server/domain/search";
import {
  assignTasksToGoal,
  captureTasks,
  claimTask,
  completeTask,
  listTasks,
  releaseTask,
  suggestNextActions,
  updateTask,
} from "@/server/domain/tasks";

import { asUser, connectAgent, createTestDb, isoDay, seedTenant, seedUser, type TestDb } from "./support/db";

let testDb: TestDb;
let human: Ctx;
let scout: Ctx;
let closer: Ctx;

beforeAll(async () => {
  testDb = await createTestDb();
  const tenant = await seedTenant(testDb.db, "acme", "Acme");
  human = asUser(testDb.db, tenant, await seedUser(testDb.db, "Dana"));
  scout = (await connectAgent(human, "Scout")).ctx;
  closer = (await connectAgent(human, "Closer")).ctx;
});

afterAll(() => testDb.close());

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

    const done = await completeTask(holder, { taskId: task!.id, note: "Sent 4 reminders" });
    expect(done).toMatchObject({ status: "done", claimedByAgentId: null });
    expect(done.description).toContain(`Completion note (${holder.actor.name}): Sent 4 reminders`);
  });

  it("lets humans step in on claimed tasks and agents release their own", async () => {
    const {
      created: [task],
    } = await captureTasks(human, { tasks: [{ title: "Renew domain", status: "todo" }] });
    await claimTask(scout, { taskId: task!.id });

    const released = await releaseTask(scout, { taskId: task!.id });
    expect(released).toMatchObject({ status: "todo", claimedByAgentId: null });

    await claimTask(scout, { taskId: task!.id });
    const dropped = await updateTask(human, { taskId: task!.id, status: "dropped" });
    expect(dropped).toMatchObject({ status: "dropped", claimedByAgentId: null });
    await expect(claimTask(closer, { taskId: task!.id })).rejects.toMatchObject({ code: "conflict" });
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
        { title: "Urgent and due soon", dueDate: isoDay(2), priority: "urgent", status: "todo" },
        { title: "Due next month", dueDate: isoDay(30), status: "todo" },
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
    await expect(updateTask(human, { taskId: "t_whatever" })).rejects.toMatchObject({ code: "not_found" });
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
  });

  it("searches goals, tasks, and memories together with prefix matching", async () => {
    await remember(scout, { content: "Auditors want the ledger export as CSV" });
    const hits = await search(human, { query: "audit" });
    expect(new Set(hits.map((hit) => hit.kind))).toEqual(new Set(["task", "memory"]));
    expect(hits.some((hit) => hit.title === "Reply to auditor")).toBe(true);

    const onlyGoals = await search(human, { query: "hiring", kinds: ["goal"] });
    expect(onlyGoals.map((hit) => hit.title)).toEqual(["Hiring"]);
    await expect(search(human, { query: "!!!" })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("read models", () => {
  it("summarizes workspace status", async () => {
    const summary = await getStatusSummary(scout, {});
    expect(summary.workspace.slug).toBe("acme");
    expect(summary.agents).toBe(2);
    expect(summary.activeAgents).toBe(2);
    expect(summary.overdue).toBe(1);
    expect(summary.overdueTasks.map((task) => task.title)).toEqual(["Overdue filing"]);
    expect(summary.pendingApprovals).toBe(summary.goalsByStatus.proposed);
    expect(summary.goalsByStatus.proposed).toBeGreaterThan(0);
    expect(summary.openTasks).toBe(
      summary.tasksByStatus.inbox + summary.tasksByStatus.todo + summary.tasksByStatus.in_progress,
    );
    expect(summary.lastActivityAt).toBeInstanceOf(Date);
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
      ],
    });
    await completeTask(human, { taskId: created[0]!.id });

    const board = await getBoard(human, { goalId: goal.id });
    const titles = Object.fromEntries(board.columns.map((column) => [column.status, column.tasks.map((task) => task.title)]));
    expect(titles).toEqual({ inbox: [], todo: ["Order desks"], in_progress: [], done: ["Sign lease"] });

    const timeline = await getTimeline(human, {});
    expect(timeline.map((task) => task.dueDate)).toEqual([...timeline.map((task) => task.dueDate)].sort());
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
});
