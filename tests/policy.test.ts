import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { approveAgent, archiveAgent, archiveRevokedAgents, canTransferClaims, createAgent, listAgents, revokeAgent, unarchiveAgent } from "@/server/domain/agents";
import { attachDocument } from "@/server/domain/documents";
import { DEFAULT_WORKFLOW } from "@/lib/workflow";
import { saveWorkflow } from "@/server/domain/workflow";
import { deleteWebhook } from "@/server/domain/webhooks";
import { AGENT_ROLES, type Actor, type Ctx, type Role } from "@/server/domain/context";
import { grantableLevels } from "@/lib/domain";
import { PERMISSIONS, roleCan } from "@/lib/permissions";
import { createGoal, setGoalStatus } from "@/server/domain/goals";
import { answerFromNotification, muteWorkspace, openDecisions, unmuteWorkspace } from "@/server/domain/notifications";
import { ACTIONS, can, type Action } from "@/server/domain/policy";
import { captureTasks, transferClaims } from "@/server/domain/tasks";
import { approvePipelineVersion, archivePipeline, definePipeline, listStuckStops, resendHandoff, startRun, updatePipeline, updateRun } from "@/server/domain/pipelines";
import { listPendingInvitations } from "@/server/domain/tenants";
import { deleteWorkspace, workspaceInventory } from "@/server/domain/workspace-deletion";
import { organization } from "@/server/db/schema";
import { eq } from "drizzle-orm";

import * as backoffice from "@/server/backoffice";
import { platformContext, type PlatformCtx } from "@/server/backoffice/context";
import { platformWorkspaceAccess, WORKSPACE_APP_VIEW } from "@/server/backoffice/workspace-access";
import { backofficeAudit } from "@/server/db/schema";
import { TOOLS } from "@/server/mcp/tools";

import { ADMIN_EMAIL, everyBackofficeCall, seedPlatformAdmin } from "./support/backoffice";
import { addMember, asUser, createTestDb, seedUser, seedWorkspace, type TestDb } from "./support/db";
import { freshProof } from "./support/deletion";

const CONTRIBUTE: readonly Action[] = ["workspace:read", "goal:write", "task:write", "memory:write", "document:write"];
const AGENT_WRITE: readonly Action[] = [...CONTRIBUTE, "agent:delegate", "webhook:manage", "pipeline:write"];

const EXPECTED: Record<Role, readonly Action[]> = {
  owner: ACTIONS,
  // Everything but deleting the workspace, which is its owner's alone.
  admin: ACTIONS.filter((action) => action !== "workspace:delete"),
  member: ["workspace:read", "goal:write", "goal:decide", "task:write", "memory:write", "document:write", "agent:connect", "digest:subscribe", "notify:subscribe", "pipeline:write"],
  agent_read: ["workspace:read"],
  agent_write: AGENT_WRITE,
  agent_admin: ["workspace:read", "goal:write", "task:write", "memory:write", "document:write", "agent:manage", "agent:delegate", "webhook:manage", "pipeline:write"],
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
    // The digest is mail to a person: no agent, and no read-only platform admin, subscribes.
    for (const role of AGENT_ROLES) expect(can(agent(role), "digest:subscribe")).toBe(false);
    expect(can(person("platform_admin"), "digest:subscribe")).toBe(false);
    // Decision notifications are a member's: no agent and no platform admin subscribes, every member role does.
    for (const role of AGENT_ROLES) expect(can(agent(role), "notify:subscribe")).toBe(false);
    expect(can(person("platform_admin"), "notify:subscribe")).toBe(false);
    for (const role of ["owner", "admin", "member"] as const) expect(can(person(role), "notify:subscribe")).toBe(true);
    expect(can(person("member"), "agent:connect")).toBe(true);
    expect(can(person("member"), "agent:issue_key")).toBe(false);
    expect(can(person("admin"), "agent:issue_key")).toBe(true);
    expect(grantableLevels("member")).toEqual(["read", "write"]);
    expect(grantableLevels("owner")).toEqual(["read", "write", "admin"]);
  });

  it("lets members and Write agents define and run pipelines, and only owners and admins change any regular one", () => {
    for (const role of ["owner", "admin", "member"] as const) expect(can(person(role), "pipeline:write")).toBe(true);
    expect(can(agent("agent_write"), "pipeline:write")).toBe(true);
    expect(can(agent("agent_read"), "pipeline:write")).toBe(false);
    expect(can(person("platform_admin"), "pipeline:write")).toBe(false);
    for (const role of ["owner", "admin"] as const) expect(can(person(role), "pipeline:manage")).toBe(true);
    expect(can(person("member"), "pipeline:manage")).toBe(false);
    // An agent's change to a regular pipeline is always a proposal a person approves, whatever its level.
    for (const role of AGENT_ROLES) expect(can(agent(role), "pipeline:manage")).toBe(false);
  });

  it("lets a person grant Admin exactly when their role manages agents in the policy matrix", () => {
    for (const role of Object.keys(PERMISSIONS)) expect(grantableLevels(role).includes("admin"), role).toBe(roleCan(role, "agent:manage"));
    expect(roleCan("constructor", "agent:manage")).toBe(false);
  });
});

describe("handing one agent's claims to another", () => {
  const approver = { createdByUserId: "u_1" };
  const someoneElse = { createdByUserId: "u_2" };

  it("is for a person who approved both agents, or one who manages agents", () => {
    expect(canTransferClaims(person("member"), approver, approver)).toBe(true);
    expect(canTransferClaims(person("member"), approver, someoneElse)).toBe(false);
    expect(canTransferClaims(person("member"), someoneElse, approver)).toBe(false);
    expect(canTransferClaims(person("member"), { createdByUserId: null }, approver)).toBe(false);
    for (const role of ["owner", "admin"] as const) expect(canTransferClaims(person(role), someoneElse, someoneElse)).toBe(true);
    expect(canTransferClaims(person("platform_admin"), approver, approver)).toBe(false);
  });

  it("is never an agent's, even at Admin", () => {
    for (const role of AGENT_ROLES) expect(canTransferClaims(agent(role), approver, approver)).toBe(false);
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

  it("lets members, not platform admins or agents, mute and read a workspace's notifications", async () => {
    const { db } = testDb;
    const { scout } = await seedWorkspace(db);
    for (const person of [owner, member]) {
      await expect(muteWorkspace(person, {})).resolves.toEqual({ muted: true });
      await expect(openDecisions(person, {})).resolves.toMatchObject({ muted: true, pending: 0 });
      await expect(unmuteWorkspace(person, {})).resolves.toEqual({ muted: false });
    }
    for (const outsider of [platformAdmin, scout.ctx]) {
      await expect(muteWorkspace(outsider, {})).rejects.toMatchObject({ code: "forbidden" });
      await expect(unmuteWorkspace(outsider, {})).rejects.toMatchObject({ code: "forbidden" });
      await expect(openDecisions(outsider, {})).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(answerFromNotification(platformAdmin, { taskId: "t_any", requestId: "q_any", option: 0 })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lets members define and run pipelines, keeps a regular one its owner's and admins', and makes an agent's change a proposal", async () => {
    const { scout } = await seedWorkspace(testDb.db);
    const definition = { stops: [{ id: "one", name: "One", kind: "any_agent" as const, then: { end: "done" } }], ends: [{ id: "done", name: "Done" }] };
    await expect(definePipeline(platformAdmin, { name: "Nope", definition })).rejects.toMatchObject({ code: "forbidden" });
    const { pipeline } = await definePipeline(member, { name: "Member's line", definition });
    expect(pipeline.ownerUserId).toBe(member.actor.id);
    await expect(startRun(platformAdmin, { pipelineId: pipeline.id })).rejects.toMatchObject({ code: "forbidden" });
    const started = await startRun(owner, { pipelineId: pipeline.id });
    expect(started.run.number).toBe(1);
    // Renaming a run and resending a stop's handoff are run changes, as cancelling and rerunning are.
    await expect(updateRun(platformAdmin, { runId: started.run.id, name: "Nope" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(resendHandoff(platformAdmin, { runId: started.run.id, stopId: "one" })).rejects.toMatchObject({ code: "forbidden" });
    // A Read agent changes no run, as it starts, cancels and reruns none.
    const reader: typeof owner = { ...owner, actor: { type: "agent", id: "ag_reader", name: "Reader", role: "agent_read" } };
    await expect(updateRun(reader, { runId: started.run.id, name: "Nope" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(resendHandoff(reader, { runId: started.run.id, stopId: "one" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateRun(member, { runId: started.run.id, name: "Q3 memo" })).resolves.toMatchObject({ run: { name: "Q3 memo" } });
    expect(await listStuckStops(platformAdmin, {})).toEqual([]);
    // The owner of the workspace may change any regular pipeline; the member owns theirs.
    await expect(updatePipeline(owner, { pipelineId: pipeline.id, description: "Ours" })).resolves.toMatchObject({ pipeline: { description: "Ours" } });
    const { pipeline: owners } = await definePipeline(owner, { name: "Owner's line", definition });
    await expect(archivePipeline(member, { pipelineId: owners.id })).rejects.toMatchObject({ code: "forbidden" });
    // An agent in this workspace proposes; only a person who may change it approves.
    const other = await seedWorkspace(testDb.db);
    const { pipeline: theirs } = await definePipeline(other.human, { name: "Line", definition });
    const proposed = await updatePipeline(other.scout.ctx, { pipelineId: theirs.id, name: "Better line", reason: "Clearer" });
    expect(proposed.proposal).toMatchObject({ proposalState: "proposed" });
    await expect(approvePipelineVersion(other.closer.ctx, { pipelineId: theirs.id, version: 2 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(archivePipeline(scout.ctx, { pipelineId: pipeline.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(archivePipeline(other.scout.ctx, { pipelineId: theirs.id })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lets only the owner delete the workspace: never an admin, a member, an agent of any level, or a platform admin", async () => {
    const { db } = testDb;
    const { tenant, human, scout } = await seedWorkspace(db);
    const admin = asUser(db, tenant, await seedUser(db, "Admin"), "admin");
    await addMember(db, tenant, { id: admin.actor.id, name: "Admin", email: `admin.${admin.actor.id}@example.com` }, "admin");
    const agents = (["agent_read", "agent_write", "agent_admin"] as const).map((role): Ctx => ({ ...scout.ctx, actor: { ...scout.ctx.actor, role } as Ctx["actor"] }));
    for (const role of ["agent_read", "agent_write", "agent_admin", "platform_admin", "member", "admin"] as const) {
      expect(can(actorWith(role), "workspace:delete"), role).toBe(false);
    }
    expect(can(actorWith("owner"), "workspace:delete")).toBe(true);
    for (const ctx of [admin, member, platformAdmin, ...agents].map((one) => ({ ...one, tenant }))) {
      await expect(workspaceInventory(ctx, {})).rejects.toMatchObject({ code: "forbidden" });
      await expect(deleteWorkspace(ctx, { confirm: tenant.name }, freshProof())).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await db.select({ id: organization.id }).from(organization).where(eq(organization.id, tenant.id))).toHaveLength(1);
    await expect(deleteWorkspace(human, { confirm: tenant.name }, freshProof())).resolves.toMatchObject({ id: tenant.id });
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

  it("lets a member hand over only their own agents' claims, and an owner anyone's", async () => {
    const grant = { level: "write", lifetimeDays: 30, oauthClientId: "client_1" } as const;
    const { agent: mine } = await approveAgent(member, { ...grant, name: "Claude" });
    const { agent: alsoMine } = await approveAgent(member, { ...grant, name: "Claude Content Agent" });
    const { agent: owners } = await approveAgent(owner, { ...grant, name: "Owner's agent" });
    await expect(transferClaims(member, { fromAgentId: mine.id, toAgentId: alsoMine.id })).resolves.toEqual({ moved: [] });
    await expect(transferClaims(member, { fromAgentId: owners.id, toAgentId: mine.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(transferClaims(member, { fromAgentId: mine.id, toAgentId: owners.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(transferClaims(platformAdmin, { fromAgentId: mine.id, toAgentId: alsoMine.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(transferClaims(owner, { fromAgentId: mine.id, toAgentId: owners.id })).resolves.toEqual({ moved: [] });
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

describe("backoffice access", () => {
  let backofficeDb: TestDb;
  let workspace: Awaited<ReturnType<typeof seedWorkspace>>;

  beforeAll(async () => {
    backofficeDb = await createTestDb();
  });
  beforeEach(async () => {
    vi.stubEnv("PHEAN_PLATFORM_ADMINS", ADMIN_EMAIL);
    vi.stubEnv("PHEAN_ADMIN_REQUIRE_2FA", "0");
    workspace = await seedWorkspace(backofficeDb.db);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => backofficeDb.close());

  it("lists every backoffice service in the refusal checks", () => {
    expect(everyBackofficeCall("x").map(([name]) => name).sort()).toEqual(Object.keys(backoffice).sort());
  });

  it("refuses people, agents of every level, and unverified or unlisted addresses in every service", async () => {
    const db = backofficeDb.db;
    const owner = workspace.human.actor;
    const { agent: reader } = await approveAgent(workspace.human, { name: "Reader", level: "read", lifetimeDays: 30, oauthClientId: "client_r" });
    const { agent: chief } = await approveAgent(workspace.human, { name: "Chief", level: "admin", lifetimeDays: 30, oauthClientId: "client_a" });
    const refused: [string, PlatformCtx][] = [
      ["a workspace owner", platformContext(db, { id: owner.id, name: owner.name, email: "dana@example.com" })],
      ["a Write agent", platformContext(db, { id: workspace.scout.agentId, name: "Scout", email: ADMIN_EMAIL })],
      ["a Read agent", platformContext(db, { id: reader.id, name: "Reader", email: ADMIN_EMAIL })],
      ["an Admin agent", platformContext(db, { id: chief.id, name: "Chief", email: ADMIN_EMAIL })],
      ["a listed but unverified address", await seedPlatformAdmin(db, { verified: false, email: ADMIN_EMAIL.replace("ops", `ops+${Date.now()}`) })],
      ["a verified address that is not listed", await seedPlatformAdmin(db, { email: `someone.${Date.now()}@phean.example` })],
    ];
    // The unverified admin must be listed for the check to mean anything.
    vi.stubEnv("PHEAN_PLATFORM_ADMINS", `${ADMIN_EMAIL},${refused[4]![1].admin.email}`);
    for (const [who, ctx] of refused) {
      for (const [name, call] of everyBackofficeCall(workspace.tenant.slug)) {
        await expect(call(ctx), `${name} for ${who}`).rejects.toMatchObject({ code: "forbidden" });
      }
    }
    // Nothing they tried was recorded as a look.
    expect(await db.select().from(backofficeAudit)).toEqual([]);
  });

  it("asks for two-factor when PHEAN_ADMIN_REQUIRE_2FA is on, and lets the admin in once it is", async () => {
    vi.stubEnv("PHEAN_PLATFORM_ADMINS", `second.${ADMIN_EMAIL},third.${ADMIN_EMAIL}`);
    vi.stubEnv("PHEAN_ADMIN_REQUIRE_2FA", "1");
    const without = await seedPlatformAdmin(backofficeDb.db, { email: `second.${ADMIN_EMAIL}` });
    const withTwoFactor = await seedPlatformAdmin(backofficeDb.db, { email: `third.${ADMIN_EMAIL}`, twoFactor: true });
    for (const [name, call] of everyBackofficeCall(workspace.tenant.slug)) {
      await expect(call(without), name).rejects.toThrow("Turn on two-factor");
    }
    await expect(backoffice.getOverview(withTwoFactor, {})).resolves.toMatchObject({ totals: expect.any(Object) });
  });

  it("opens a workspace's app pages to a platform admin only within a content grant, recorded once", async () => {
    const db = backofficeDb.db;
    const admin = await seedPlatformAdmin(db, { email: `app.${Date.now()}.${ADMIN_EMAIL}` });
    vi.stubEnv("PHEAN_PLATFORM_ADMINS", admin.admin.email);
    const other = await seedWorkspace(db, { name: "Other" });
    const appViews = async () => (await db.select().from(backofficeAudit)).filter((row) => row.adminUserId === admin.admin.id && row.action === WORKSPACE_APP_VIEW);

    expect(await platformWorkspaceAccess(admin, workspace.tenant.id)).toBe("needs_grant");
    await backoffice.revealContent(admin, { slug: workspace.tenant.slug, reason: "Ticket 9: board looks empty" });
    expect(await platformWorkspaceAccess(admin, workspace.tenant.id)).toBe("granted");
    expect(await platformWorkspaceAccess(admin, workspace.tenant.id)).toBe("granted");
    expect(await appViews()).toEqual([expect.objectContaining({ tenantId: workspace.tenant.id, reason: "Ticket 9: board looks empty" })]);
    // The grant is for that workspace only, and lapses.
    expect(await platformWorkspaceAccess(admin, other.tenant.id)).toBe("needs_grant");
    expect(await platformWorkspaceAccess(admin, workspace.tenant.id, new Date(Date.now() + 31 * 60_000))).toBe("needs_grant");

    // Two-factor, when required, comes first, grant or not.
    vi.stubEnv("PHEAN_ADMIN_REQUIRE_2FA", "1");
    expect(await platformWorkspaceAccess(admin, workspace.tenant.id)).toBe("two_factor");
    // And someone who is no longer listed is not an admin at all.
    vi.stubEnv("PHEAN_PLATFORM_ADMINS", ADMIN_EMAIL);
    expect(await platformWorkspaceAccess(admin, workspace.tenant.id)).toBe("not_admin");
  });

  it("offers agents no backoffice tool", () => {
    // Backoffice services take a PlatformCtx, which only a session builds; no tool reaches one.
    expect(TOOLS.filter((tool) => /backoffice|platform|usage|audit/.test(tool.name))).toEqual([]);
  });
});
