import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { tasks } from "@/server/db/schema";
import { authenticateAgentToken } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";
import { listActivity } from "@/server/domain/events";
import { createGoal, findGoal, listGoals, updateGoal, type Goal } from "@/server/domain/goals";
import { forget, recall, remember, type Memory } from "@/server/domain/memory";
import { getBoard, getGoalDetail, getStatusSummary } from "@/server/domain/overview";
import { search } from "@/server/domain/search";
import {
  answerInput,
  assignTasksToGoal,
  captureTasks,
  claimTask,
  collectAnswers,
  linkSession,
  listDecisions,
  listTasks,
  requestInput,
  updateTask,
  type Task,
} from "@/server/domain/tasks";
import { getWorkspaceOverviews, listMemberships } from "@/server/domain/tenants";

import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";

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
      expect(await recall(ctx, {})).toEqual([]);
      expect(await search(ctx, { query: "merger" })).toEqual([]);
      expect(await listActivity(ctx, {})).not.toContainEqual(expect.objectContaining({ actorName: "Dana" }));
      expect((await getStatusSummary(ctx, {})).openTasks).toBe(0);
    }
  });

  it("keeps questions, decisions, and answers inside their workspace", async () => {
    await requestInput(acme.scout.ctx, { taskId: acmeTask.id, kind: "decision", question: "Sign the merger?", options: ["Yes", "No"] });
    for (const ctx of [globexOwner, globexAgent]) expect(await listDecisions(ctx, {})).toEqual({ open: [], closed: [] });
    await answerInput(acmeOwner, { taskId: acmeTask.id, answer: "Yes" });
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

  it("shows each user only the workspaces they belong to", async () => {
    const memberships = await listMemberships(testDb.db, acmeOwner.actor.id);
    expect(memberships.map((membership) => [membership.tenant.slug, membership.role])).toEqual([[acme.tenant.slug, "owner"]]);

    const [overview] = await getWorkspaceOverviews(testDb.db, memberships);
    expect(overview).toMatchObject({ openTasks: 1, inbox: 1, activeGoals: 1, agents: 2 });
  });
});
