import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { approveAgent, archiveAgent, archiveRevokedAgents, createAgent, listAgents, revokeAgent, unarchiveAgent } from "@/server/domain/agents";
import { attachDocument } from "@/server/domain/documents";
import { DEFAULT_WORKFLOW } from "@/lib/workflow";
import { saveWorkflow } from "@/server/domain/workflow";
import { deleteWebhook } from "@/server/domain/webhooks";
import { AGENT_ROLES, type Actor, type Ctx, type Role } from "@/server/domain/context";
import { grantableLevels } from "@/lib/domain";
import { PERMISSIONS, roleCan } from "@/lib/permissions";
import { createGoal, setGoalStatus } from "@/server/domain/goals";
import { ACTIONS, can, type Action } from "@/server/domain/policy";
import { captureTasks } from "@/server/domain/tasks";
import { listPendingInvitations } from "@/server/domain/tenants";

import { addMember, asUser, createTestDb, seedUser, seedWorkspace, type TestDb } from "./support/db";

const CONTRIBUTE: readonly Action[] = ["workspace:read", "goal:write", "task:write", "memory:write", "document:write"];
const AGENT_WRITE: readonly Action[] = [...CONTRIBUTE, "agent:delegate", "webhook:manage"];

const EXPECTED: Record<Role, readonly Action[]> = {
  owner: ACTIONS,
  admin: ACTIONS,
  member: ["workspace:read", "goal:write", "goal:decide", "task:write", "memory:write", "document:write", "agent:connect"],
  agent_read: ["workspace:read"],
  agent_write: AGENT_WRITE,
  agent_admin: ["workspace:read", "goal:write", "task:write", "memory:write", "document:write", "agent:manage", "agent:delegate", "webhook:manage"],
  platform_admin: ["workspace:read"],
};

function actorWith(role: Role): Actor {
  return role.startsWith("agent_")
    ? ({ type: "agent", id: "ag_1", name: "Bot", role } as Actor)
    : ({ type: "user", id: "u_1", name: "Person", role } as Actor);
}

const agent = actorWith;
const person = actorWith;

describe("policy matrix", () => {
  for (const [role, allowed] of Object.entries(EXPECTED) as [Role, readonly Action[]][]) {
    it(`grants ${role} exactly its actions`, () => {
      const granted = ACTIONS.filter((action) => can(actorWith(role), action));
      expect(granted).toEqual([...allowed]);
    });
  }

  it("scales agent powers with access level and keeps decisions human", () => {
    expect(can(agent("agent_read"), "workspace:read")).toBe(true);
    expect(can(agent("agent_read"), "task:write")).toBe(false);
    expect(can(agent("agent_read"), "webhook:manage")).toBe(false);
    expect(can(agent("agent_write"), "task:write")).toBe(true);
    expect(can(agent("agent_write"), "agent:manage")).toBe(false);
    expect(can(agent("agent_admin"), "agent:manage")).toBe(true);
    expect(can(agent("agent_admin"), "agent:issue_key")).toBe(false);
    expect(can(agent("agent_admin"), "member:manage")).toBe(false);
    for (const role of AGENT_ROLES) expect(can(agent(role), "goal:decide")).toBe(false);
    expect(can(person("member"), "agent:connect")).toBe(true);
    expect(can(person("member"), "agent:issue_key")).toBe(false);
    expect(can(person("admin"), "agent:issue_key")).toBe(true);
    expect(grantableLevels("member")).toEqual(["read", "write"]);
    expect(grantableLevels("owner")).toEqual(["read", "write", "admin"]);
  });

  it("lets a person grant Admin exactly when their role manages agents in the policy matrix", () => {
    for (const role of Object.keys(PERMISSIONS)) expect(grantableLevels(role).includes("admin"), role).toBe(roleCan(role, "agent:manage"));
    expect(roleCan("constructor", "agent:manage")).toBe(false);
  });
});

describe("policy enforcement in services", () => {
  let testDb: TestDb;
  let owner: Ctx;
  let member: Ctx;
  let platformAdmin: Ctx;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    const { db } = testDb;
    const { tenant, human } = await seedWorkspace(db);
    owner = human;
    const person = await seedUser(db, "Member");
    await addMember(db, tenant, person, "member");
    member = asUser(db, tenant, person, "member");
    platformAdmin = asUser(db, tenant, await seedUser(db, "Support"), "platform_admin");
  });

  afterAll(() => testDb.close());

  it("lets members decide goals but not manage agents or members", async () => {
    const goal = await createGoal(member, { title: "Member goal" });
    await expect(setGoalStatus(member, { goalId: goal.id, status: "achieved" })).resolves.toMatchObject({
      status: "achieved",
    });
    await expect(createAgent(member, { name: "Bot" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listPendingInvitations(member, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteWebhook(member, { agentId: "ag_any" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteWebhook(platformAdmin, { agentId: "ag_any" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteWebhook(owner, { agentId: "ag_any" })).resolves.toEqual({ removed: false });
  });

  it("lets only owners and admins change the board's stages, and anyone who writes attach documents", async () => {
    const stages = DEFAULT_WORKFLOW.map((stage) => (stage.key === "inbox" ? { ...stage, label: "Triage" } : stage));
    await expect(saveWorkflow(member, { stages })).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveWorkflow(platformAdmin, { stages })).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveWorkflow(owner, { stages })).resolves.toContainEqual(
      expect.objectContaining({ key: "inbox", label: "Triage" }),
    );
    await expect(attachDocument(member, { title: "Notes", content: "# Notes" })).resolves.toMatchObject({ createdByName: "Member" });
    await expect(attachDocument(platformAdmin, { title: "Notes", content: "x" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps platform admins read-only", async () => {
    await expect(createGoal(platformAdmin, { title: "Nope" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(captureTasks(platformAdmin, { tasks: [{ title: "Nope" }] })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await listAgents(platformAdmin, {})).map((agent) => agent.name).sort()).toEqual(["Closer", "Scout"]);
  });

  it("lets owners issue and revoke agents without exposing token hashes", async () => {
    const { agent, token } = await createAgent(owner, { name: "Scout" });
    expect(token.startsWith(agent.tokenPrefix!)).toBe(true);
    expect(Object.keys(agent)).not.toContain("tokenHash");

    await revokeAgent(owner, { agentId: agent.id });
    await expect(revokeAgent(owner, { agentId: agent.id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps approving and revoking agents from the read-only role, and members to their own", async () => {
    const grant = { name: "Laptop", level: "write", lifetimeDays: 30, oauthClientId: "client_1" } as const;
    await expect(approveAgent(platformAdmin, grant)).rejects.toMatchObject({ code: "forbidden" });
    const { agent } = await approveAgent(owner, grant);
    await expect(revokeAgent(platformAdmin, { agentId: agent.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(revokeAgent(member, { agentId: agent.id })).rejects.toThrow("did not connect themselves");
  });

  it("lets only owners and admins archive revoked agents", async () => {
    const { agent } = await createAgent(owner, { name: "Old bot" });
    await revokeAgent(owner, { agentId: agent.id });
    for (const ctx of [member, platformAdmin]) {
      await expect(archiveAgent(ctx, { agentId: agent.id })).rejects.toMatchObject({ code: "forbidden" });
      await expect(archiveRevokedAgents(ctx, {})).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await archiveAgent(owner, { agentId: agent.id })).toEqual({ archived: 1 });
    await expect(unarchiveAgent(member, { agentId: agent.id })).rejects.toMatchObject({ code: "forbidden" });
  });
});
