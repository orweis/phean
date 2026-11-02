import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { tasks } from "@/server/db/schema";
import { authenticateAgentToken } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";
import { listActivity } from "@/server/domain/events";
import { createGoal, findGoal, listGoals, updateGoal, type Goal } from "@/server/domain/goals";
import { forget, recall, remember, type Memory } from "@/server/domain/memory";
import { getBoard, getGoalDetail, getStatusSummary } from "@/server/domain/overview";
import { search } from "@/server/domain/search";
import { assignTasksToGoal, captureTasks, claimTask, listTasks, updateTask, type Task } from "@/server/domain/tasks";
import { getWorkspaceOverviews, listMemberships } from "@/server/domain/tenants";

import { addMember, asUser, connectAgent, createTestDb, seedTenant, seedUser, type TestDb } from "./support/db";

let testDb: TestDb;
let acmeOwner: Ctx;
let globexOwner: Ctx;
let globexAgent: Ctx;
let globexToken: string;
let acmeGoal: Goal;
let acmeTask: Task;
let acmeMemory: Memory;

beforeAll(async () => {
  testDb = await createTestDb();
  const { db } = testDb;
  const acme = await seedTenant(db, "acme", "Acme");
  const globex = await seedTenant(db, "globex", "Globex");
  const dana = await seedUser(db, "Dana");
  const eli = await seedUser(db, "Eli");
  await addMember(db, acme, dana, "owner");
  await addMember(db, globex, eli, "owner");

  acmeOwner = asUser(db, acme, dana);
  globexOwner = asUser(db, globex, eli);
  ({ ctx: globexAgent, token: globexToken } = await connectAgent(globexOwner, "Globex bot"));

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

  it("rejects writes that reference another tenant's records", async () => {
    const globexGoal = await createGoal(globexOwner, { title: "Globex goal" });

    await expect(updateTask(globexAgent, { taskId: acmeTask.id, title: "pwned" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(claimTask(globexAgent, { taskId: acmeTask.id })).rejects.toMatchObject({ code: "not_found" });
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
    const principal = await authenticateAgentToken(testDb.db, globexToken);
    expect(principal?.tenant.slug).toBe("globex");
  });

  it("shows each user only the workspaces they belong to", async () => {
    const memberships = await listMemberships(testDb.db, acmeOwner.actor.id);
    expect(memberships.map((membership) => [membership.tenant.slug, membership.role])).toEqual([["acme", "owner"]]);

    const [overview] = await getWorkspaceOverviews(testDb.db, memberships);
    expect(overview).toMatchObject({ openTasks: 1, inbox: 1, activeGoals: 1, agents: 0 });
  });
});
