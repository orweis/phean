import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { isoDayFromToday } from "@/lib/dates";
import { createGoal } from "@/server/domain/goals";
import { browseTasks } from "@/server/domain/overview";
import { captureTasks, claimTask, completeTask, updateTask, type Task } from "@/server/domain/tasks";

import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";

let testDb: TestDb;
let acme: Workspace;
let tasks: Record<"soon" | "later" | "undated" | "done" | "dropped" | "sub", Task>;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  acme = await seedWorkspace(testDb.db);
  const parent = await createGoal(acme.human, { title: "Close the books" });
  const child = await createGoal(acme.human, { title: "Payroll", parentGoalId: parent.id });
  const { created } = await captureTasks(acme.scout.ctx, {
    tasks: [
      { title: "Soon", dueDate: isoDayFromToday(1), goalId: parent.id },
      { title: "Later", dueDate: isoDayFromToday(40) },
      { title: "Undated" },
      { title: "Finished", dueDate: isoDayFromToday(2) },
      { title: "Dropped" },
      { title: "In a sub-goal", goalId: child.id },
    ],
  });
  const [soon, later, undated, done, dropped, sub] = created as Task[];
  tasks = { soon: soon!, later: later!, undated: undated!, done: done!, dropped: dropped!, sub: sub! };
  await claimTask(acme.scout.ctx, { taskId: done!.id });
  await completeTask(acme.scout.ctx, { taskId: done!.id });
  await updateTask(acme.human, { taskId: dropped!.id, status: "dropped" });
});

afterAll(() => testDb.close());

const titles = (result: { tasks: Task[] }) => result.tasks.map((task) => task.title).sort();

describe("browsing tasks for the Tasks page's layouts", () => {
  it("lists the open tasks by default, everything but dropped with `all`, or one status", async () => {
    expect(titles(await browseTasks(acme.human, {}))).toEqual(["In a sub-goal", "Later", "Soon", "Undated"]);
    expect(titles(await browseTasks(acme.human, { status: "all" }))).toEqual(["Finished", "In a sub-goal", "Later", "Soon", "Undated"]);
    expect(titles(await browseTasks(acme.human, { status: "done" }))).toEqual(["Finished"]);
  });

  it("scopes to a goal and its sub-goals, a due window, or tasks with no due date", async () => {
    const goal = tasks.soon.goalId!;
    expect(titles(await browseTasks(acme.human, { goalId: goal }))).toEqual(["In a sub-goal", "Soon"]);
    expect(titles(await browseTasks(acme.human, { status: "all", dueFrom: isoDayFromToday(0), dueTo: isoDayFromToday(7) }))).toEqual(["Finished", "Soon"]);
    expect(titles(await browseTasks(acme.human, { undated: true }))).toEqual(["In a sub-goal", "Undated"]);
  });

  it("counts every match, so a layout can say when it shows only the first few", async () => {
    const page = await browseTasks(acme.human, { limit: 2 });
    expect(page.tasks).toHaveLength(2);
    expect(page.total).toBe(4);
  });

  it("filters to what an agent holds", async () => {
    await claimTask(acme.closer.ctx, { taskId: tasks.later.id });
    expect(titles(await browseTasks(acme.human, { heldBy: acme.closer.agentId }))).toEqual(["Later"]);
  });
});
