import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAgent, listAgents, revokeAgent } from "@/server/domain/agents";
import type { Actor, Ctx, Role } from "@/server/domain/context";
import { createGoal, setGoalStatus } from "@/server/domain/goals";
import { ACTIONS, can, type Action } from "@/server/domain/policy";
import { captureTasks } from "@/server/domain/tasks";
import { listPendingInvitations } from "@/server/domain/tenants";

import { asUser, createTestDb, seedTenant, seedUser, type TestDb } from "./support/db";

const EXPECTED: Record<Role, readonly Action[]> = {
  owner: ACTIONS,
  admin: ACTIONS,
  member: ["workspace:read", "goal:write", "goal:decide", "task:write", "memory:write"],
  agent: ["workspace:read", "goal:write", "task:write", "memory:write"],
  platform_admin: ["workspace:read"],
};

function actorWith(role: Role): Actor {
  return role === "agent"
    ? { type: "agent", id: "ag_1", name: "Bot", role }
    : { type: "user", id: "u_1", name: "Person", role };
}

describe("policy matrix", () => {
  for (const [role, allowed] of Object.entries(EXPECTED) as [Role, readonly Action[]][]) {
    it(`grants ${role} exactly its actions`, () => {
      const granted = ACTIONS.filter((action) => can(actorWith(role), action));
      expect(granted).toEqual([...allowed]);
    });
  }
});

describe("policy enforcement in services", () => {
  let testDb: TestDb;
  let owner: Ctx;
  let member: Ctx;
  let platformAdmin: Ctx;

  beforeAll(async () => {
    testDb = await createTestDb();
    const tenant = await seedTenant(testDb.db, "acme");
    owner = asUser(testDb.db, tenant, await seedUser(testDb.db, "Owner"), "owner");
    member = asUser(testDb.db, tenant, await seedUser(testDb.db, "Member"), "member");
    platformAdmin = asUser(testDb.db, tenant, await seedUser(testDb.db, "Support"), "platform_admin");
  });

  afterAll(() => testDb.close());

  it("lets members decide goals but not manage agents or members", async () => {
    const goal = await createGoal(member, { title: "Member goal" });
    await expect(setGoalStatus(member, { goalId: goal.id, status: "achieved" })).resolves.toMatchObject({
      status: "achieved",
    });
    await expect(createAgent(member, { name: "Bot" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listPendingInvitations(member, {})).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps platform admins read-only", async () => {
    await expect(createGoal(platformAdmin, { title: "Nope" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(captureTasks(platformAdmin, { tasks: [{ title: "Nope" }] })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(listAgents(platformAdmin, {})).resolves.toEqual([]);
  });

  it("lets owners issue and revoke agents without exposing token hashes", async () => {
    const { agent, token } = await createAgent(owner, { name: "Scout" });
    expect(token.startsWith(agent.tokenPrefix)).toBe(true);
    expect(Object.keys(agent)).not.toContain("tokenHash");

    await revokeAgent(owner, { agentId: agent.id });
    await expect(revokeAgent(owner, { agentId: agent.id })).rejects.toMatchObject({ code: "not_found" });
  });
});
