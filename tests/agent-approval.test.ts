import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DAY_MS } from "@/lib/dates";
import { agents, events, member, user } from "@/server/db/schema";
import {
  agentContext,
  approveAgent,
  authenticateAgentToken,
  createAgent,
  createSubagent,
  findRenewableAgent,
  resolveNamedSubagent,
  resolveOAuthAgent,
  revokeAgent,
  setAgentTokenRevoker,
  type AgentTokenRevoker,
} from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";

import { addMember, asUser, createTestDb, seedUser, seedWorkspace, type TestDb, type TestUser, type Workspace } from "./support/db";

let testDb: TestDb;
let ws: Workspace;
let owner: Ctx;
let mia: TestUser;
let miaCtx: Ctx;
const revoker = vi.fn<AgentTokenRevoker>();

const grant = { level: "write", lifetimeDays: 30, oauthClientId: "client_1" } as const;

async function rowOf(id: string) {
  const [row] = await testDb.db.select().from(agents).where(eq(agents.id, id));
  return row!;
}

async function eventsOf(id: string): Promise<string[]> {
  const rows = await testDb.db.select({ action: events.action }).from(events).where(eq(events.entityId, id)).orderBy(events.id);
  return rows.map((row) => row.action);
}

const expire = (id: string) => testDb.db.update(agents).set({ accessExpiresAt: new Date(Date.now() - 1000) }).where(eq(agents.id, id));

const leave = (ctx: Ctx, person: { id: string }) =>
  testDb.db.delete(member).where(and(eq(member.organizationId, ctx.tenant.id), eq(member.userId, person.id)));

const setRole = (ctx: Ctx, person: { id: string }, role: string) =>
  testDb.db.update(member).set({ role }).where(and(eq(member.organizationId, ctx.tenant.id), eq(member.userId, person.id)));

/** An agent's context the way the OAuth path builds it. */
async function signedIn(agentId: string): Promise<Ctx> {
  const principal = await resolveOAuthAgent(testDb.db, agentId);
  if (!principal) throw new Error("agent did not resolve");
  return agentContext(testDb.db, principal);
}

async function joinWorkspace(name: string, role: "admin" | "member") {
  const person = await seedUser(testDb.db, name);
  await addMember(testDb.db, ws.tenant, person, role);
  return { person, ctx: asUser(testDb.db, ws.tenant, person, role) };
}

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  ws = await seedWorkspace(testDb.db);
  owner = ws.human;
  ({ person: mia, ctx: miaCtx } = await joinWorkspace("Mia", "member"));
  revoker.mockReset();
  revoker.mockResolvedValue(undefined);
  setAgentTokenRevoker(revoker);
});

afterAll(() => testDb.close());

describe("approving an agent", () => {
  it("approving creates an oauth agent with the chosen level and expiry", async () => {
    const before = Date.now();
    const { agent, renewed } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    expect(renewed).toBe(false);
    expect(agent).toMatchObject({ authKind: "oauth", accessLevel: "write", oauthClientId: "client_1", createdByUserId: mia.id, parentAgentId: null });
    expect(agent.accessExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(agent.accessExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);
    expect(agent).not.toHaveProperty("tokenHash");
    const row = await rowOf(agent.id);
    expect(row.tokenHash).toBeNull();
    expect(row.tenantId).toBe(ws.tenant.id);
    expect(await eventsOf(agent.id)).toEqual(["agent.created"]);
  });

  it("a member cannot approve admin", async () => {
    await expect(approveAgent(miaCtx, { name: "Laptop", ...grant, level: "admin" })).rejects.toMatchObject({ code: "forbidden" });
    const rows = await testDb.db.select().from(agents).where(and(eq(agents.tenantId, ws.tenant.id), eq(agents.name, "Laptop")));
    expect(rows).toEqual([]);
  });

  it("an owner can approve admin", async () => {
    const { agent } = await approveAgent(owner, { name: "Laptop", ...grant, level: "admin" });
    expect(agent.accessLevel).toBe("admin");
  });

  it("an agent cannot approve, even at Admin", async () => {
    const { agent } = await approveAgent(owner, { name: "Lead", ...grant, level: "admin" });
    await expect(approveAgent(await signedIn(agent.id), { name: "Other", ...grant })).rejects.toMatchObject({ code: "forbidden" });
    await expect(approveAgent(ws.scout.ctx, { name: "Other", ...grant })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses a lifetime outside the choices, a bad name and an unknown level", async () => {
    await expect(approveAgent(miaCtx, { ...grant, name: "Laptop", lifetimeDays: 14 })).rejects.toMatchObject({ code: "invalid" });
    await expect(approveAgent(miaCtx, { ...grant, name: "Laptop", lifetimeDays: undefined })).rejects.toMatchObject({ code: "invalid" });
    await expect(approveAgent(miaCtx, { ...grant, name: "  " })).rejects.toMatchObject({ code: "invalid" });
    await expect(approveAgent(miaCtx, { ...grant, name: "x".repeat(81) })).rejects.toMatchObject({ code: "invalid" });
    await expect(approveAgent(miaCtx, { ...grant, name: "Laptop", level: "root" as "read" })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("renewing an agent", () => {
  it("same person, workspace and name renews the row", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant, lifetimeDays: 1 });
    const { agent: again, renewed } = await approveAgent(miaCtx, { name: "Laptop", level: "read", lifetimeDays: 90, oauthClientId: "client_2" });
    expect(renewed).toBe(true);
    expect(again.id).toBe(agent.id);
    expect(again).toMatchObject({ accessLevel: "read", oauthClientId: "client_2" });
    expect(again.accessExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 89 * DAY_MS);
    expect(revoker).toHaveBeenCalledTimes(1);
    expect(revoker).toHaveBeenCalledWith(expect.anything(), agent.id);
    expect(await eventsOf(agent.id)).toEqual(["agent.created", "agent.renewed"]);
  });

  it("renews an agent whose access has lapsed", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    await expire(agent.id);
    const { agent: again, renewed } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    expect(renewed).toBe(true);
    expect(again.id).toBe(agent.id);
    expect(await resolveOAuthAgent(testDb.db, agent.id)).not.toBeNull();
  });

  it("rolls the renewal back when the old tokens cannot be revoked", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    revoker.mockRejectedValueOnce(new Error("no"));
    await expect(approveAgent(miaCtx, { name: "Laptop", ...grant, level: "read" })).rejects.toThrow("no");
    expect((await rowOf(agent.id)).accessLevel).toBe("write");
    expect(await eventsOf(agent.id)).toEqual(["agent.created"]);
  });

  it("a different name creates a new agent", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    const { agent: other, renewed } = await approveAgent(miaCtx, { name: "Desktop", ...grant });
    expect(renewed).toBe(false);
    expect(other.id).not.toBe(agent.id);
    // Compared as the unique index does: a different case is a different name.
    const { agent: cased } = await approveAgent(miaCtx, { name: "laptop", ...grant });
    expect(cased.id).not.toBe(agent.id);
    expect(revoker).not.toHaveBeenCalled();
  });

  it("a revoked agent is never renewed", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    await revokeAgent(miaCtx, { agentId: agent.id });
    const { agent: fresh, renewed } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    expect(renewed).toBe(false);
    expect(fresh.id).not.toBe(agent.id);
    expect((await rowOf(agent.id)).revokedAt).toBeInstanceOf(Date);
    expect(await resolveOAuthAgent(testDb.db, agent.id)).toBeNull();
  });

  it("two approvals at once leave one agent", async () => {
    const results = await Promise.all([
      approveAgent(miaCtx, { name: "Laptop", ...grant }),
      approveAgent(miaCtx, { name: "Laptop", ...grant }),
    ]);
    expect(results[0].agent.id).toBe(results[1].agent.id);
    expect(results.map((result) => result.renewed).sort()).toEqual([false, true]);
    const rows = await testDb.db.select().from(agents).where(and(eq(agents.tenantId, ws.tenant.id), eq(agents.name, "Laptop")));
    expect(rows).toHaveLength(1);
  });

  it("another member's agent of the same name is not renewed", async () => {
    const { agent } = await approveAgent(owner, { name: "Laptop", ...grant });
    const { agent: mine, renewed } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    expect(renewed).toBe(false);
    expect(mine.id).not.toBe(agent.id);
    expect((await rowOf(agent.id)).createdByUserId).toBe(owner.actor.id);
  });

  it("the same person's agent in another workspace is not renewed", async () => {
    const other = await seedWorkspace(testDb.db, { name: "Globex", owner: "Eli" });
    await addMember(testDb.db, other.tenant, mia, "member");
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    const { agent: there, renewed } = await approveAgent(asUser(testDb.db, other.tenant, mia, "member"), { name: "Laptop", ...grant });
    expect(renewed).toBe(false);
    expect(there.id).not.toBe(agent.id);
  });

  it("finds what an approval would renew, and nothing else", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    await createAgent(owner, { name: "Fixed" });
    expect((await findRenewableAgent(miaCtx, "Laptop"))?.id).toBe(agent.id);
    expect((await findRenewableAgent(miaCtx, "  Laptop "))?.id).toBe(agent.id);
    expect(await findRenewableAgent(miaCtx, "laptop")).toBeNull();
    expect(await findRenewableAgent(owner, "Laptop")).toBeNull();
    expect(await findRenewableAgent(owner, "Fixed")).toBeNull();

    await expire(agent.id);
    expect((await findRenewableAgent(miaCtx, "Laptop"))?.id).toBe(agent.id);
    await revokeAgent(miaCtx, { agentId: agent.id });
    expect(await findRenewableAgent(miaCtx, "Laptop")).toBeNull();
  });
});

describe("resolving an agent", () => {
  it("resolves a live agent to its level and tenant, and records last seen", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    expect(await resolveOAuthAgent(testDb.db, agent.id)).toEqual({ agent: { id: agent.id, name: "Laptop", level: "write" }, tenant: ws.tenant });
    expect((await rowOf(agent.id)).lastSeenAt).toBeInstanceOf(Date);
  });

  it("resolve refuses revoked, expired and orphaned agents", async () => {
    const revoked = (await approveAgent(miaCtx, { name: "Revoked", ...grant })).agent;
    await revokeAgent(miaCtx, { agentId: revoked.id });
    expect(await resolveOAuthAgent(testDb.db, revoked.id)).toBeNull();

    const expired = (await approveAgent(miaCtx, { name: "Expired", ...grant })).agent;
    await expire(expired.id);
    expect(await resolveOAuthAgent(testDb.db, expired.id)).toBeNull();

    const orphaned = (await approveAgent(miaCtx, { name: "Orphaned", ...grant })).agent;
    await leave(miaCtx, mia);
    expect(await resolveOAuthAgent(testDb.db, orphaned.id)).toBeNull();

    const { person, ctx } = await joinWorkspace("Gone", "member");
    const accountDeleted = (await approveAgent(ctx, { name: "Deleted", ...grant })).agent;
    await testDb.db.delete(user).where(eq(user.id, person.id));
    expect((await rowOf(accountDeleted.id)).createdByUserId).toBeNull();
    expect(await resolveOAuthAgent(testDb.db, accountDeleted.id)).toBeNull();

    expect(await resolveOAuthAgent(testDb.db, "ag_unknown")).toBeNull();
  });

  it("resumes when the approver returns", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    await leave(miaCtx, mia);
    expect(await resolveOAuthAgent(testDb.db, agent.id)).toBeNull();
    await addMember(testDb.db, ws.tenant, mia, "member");
    expect(await resolveOAuthAgent(testDb.db, agent.id)).not.toBeNull();
  });

  it("refuses a keyed agent: only an OAuth agent signs in with OAuth", async () => {
    expect(await resolveOAuthAgent(testDb.db, ws.scout.agentId)).toBeNull();
  });

  it("resolve lowers the level when the approver is demoted", async () => {
    const { person, ctx } = await joinWorkspace("Ada", "admin");
    const { agent } = await approveAgent(ctx, { name: "Laptop", ...grant, level: "admin" });
    expect((await resolveOAuthAgent(testDb.db, agent.id))?.agent.level).toBe("admin");

    await setRole(ctx, person, "member");
    expect((await resolveOAuthAgent(testDb.db, agent.id))?.agent.level).toBe("write");
    expect((await signedIn(agent.id)).actor.role).toBe("agent_write");
    expect((await rowOf(agent.id)).accessLevel).toBe("admin");

    await setRole(ctx, person, "admin");
    expect((await resolveOAuthAgent(testDb.db, agent.id))?.agent.level).toBe("admin");
  });

  it("reads the approver's role the way Better Auth stores it", async () => {
    const { person, ctx } = await joinWorkspace("Ada", "admin");
    const { agent } = await approveAgent(ctx, { name: "Laptop", ...grant, level: "admin" });
    await setRole(ctx, person, "member,admin");
    expect((await resolveOAuthAgent(testDb.db, agent.id))?.agent.level).toBe("admin");
    await setRole(ctx, person, "something-else");
    expect((await resolveOAuthAgent(testDb.db, agent.id))?.agent.level).toBe("write");
  });

  it("an approver leaving does not affect a fixed key they issued", async () => {
    const { person, ctx } = await joinWorkspace("Ada", "admin");
    const { agent, token } = await createAgent(ctx, { name: "Fixed" });
    await leave(ctx, person);
    expect(await authenticateAgentToken(testDb.db, token)).toEqual({ agent: { id: agent.id, name: "Fixed", level: "write" }, tenant: ws.tenant });
  });
});

describe("sub-agents and their parent", () => {
  async function parentWithKey(level: "write" | "admin" = "write", approver = miaCtx) {
    const { agent } = await approveAgent(approver, { name: "Lead", ...grant, level });
    const { agent: sub, token } = await createSubagent(await signedIn(agent.id), { name: "Worker" });
    return { parent: agent, sub, token };
  }

  it("a sub-agent key stops when its OAuth parent expires, and resumes on renewal", async () => {
    const { parent, sub, token } = await parentWithKey();
    expect((await authenticateAgentToken(testDb.db, token))?.agent.id).toBe(sub.id);
    await expire(parent.id);
    expect(await authenticateAgentToken(testDb.db, token)).toBeNull();
    await approveAgent(miaCtx, { name: "Lead", ...grant });
    expect((await authenticateAgentToken(testDb.db, token))?.agent.id).toBe(sub.id);
  });

  it("a sub-agent key stops when its parent's approver leaves", async () => {
    const { token } = await parentWithKey();
    expect(await authenticateAgentToken(testDb.db, token)).not.toBeNull();
    await leave(miaCtx, mia);
    expect(await authenticateAgentToken(testDb.db, token)).toBeNull();
  });

  it("a sub-agent key stops when its keyed parent's row is revoked outside the cascade", async () => {
    const { agent: sub, token } = await createAgent(owner, { name: "Worker", parentAgentId: ws.scout.agentId });
    expect(sub.authKind).toBe("key");
    await testDb.db.update(agents).set({ revokedAt: new Date() }).where(eq(agents.id, ws.scout.agentId));
    expect(await authenticateAgentToken(testDb.db, token)).toBeNull();
  });

  it("a sub-agent never exceeds its parent's level", async () => {
    const { sub, token } = await parentWithKey("admin", owner);
    expect(sub.accessLevel).toBe("write");
    expect((await authenticateAgentToken(testDb.db, token))?.agent.level).toBe("write");

    await approveAgent(owner, { name: "Lead", ...grant, level: "read" });
    expect((await rowOf(sub.id)).accessLevel).toBe("write");
    expect((await authenticateAgentToken(testDb.db, token))?.agent.level).toBe("read");
  });

  it("a named sub-agent on an OAuth token inherits the parent's level and liveness", async () => {
    const { agent: parent } = await approveAgent(miaCtx, { name: "Lead", ...grant });
    const principal = (await resolveOAuthAgent(testDb.db, parent.id))!;
    const named = await resolveNamedSubagent(testDb.db, principal, "Helper");
    expect(named).toMatchObject({ agent: { name: "Helper", level: "write" }, tenant: ws.tenant });
    expect(named!.agent.id).not.toBe(parent.id);

    await approveAgent(miaCtx, { name: "Lead", ...grant, level: "read" });
    const lowered = (await resolveOAuthAgent(testDb.db, parent.id))!;
    expect((await resolveNamedSubagent(testDb.db, lowered, "Helper"))?.agent.level).toBe("read");

    await expire(parent.id);
    expect(await resolveNamedSubagent(testDb.db, principal, "Helper")).toBeNull();

    await approveAgent(miaCtx, { name: "Lead", ...grant });
    expect((await resolveNamedSubagent(testDb.db, principal, "Helper"))?.agent.id).toBe(named!.agent.id);

    await leave(miaCtx, mia);
    expect(await resolveNamedSubagent(testDb.db, principal, "Helper")).toBeNull();
  });

  it("a named sub-agent stays capped at Write under an Admin parent", async () => {
    const { agent: parent } = await approveAgent(owner, { name: "Lead", ...grant, level: "admin" });
    const principal = (await resolveOAuthAgent(testDb.db, parent.id))!;
    expect(principal.agent.level).toBe("admin");
    const named = await resolveNamedSubagent(testDb.db, principal, "Helper");
    expect(named?.agent.level).toBe("write");
    expect((await rowOf(named!.agent.id)).accessLevel).toBe("write");
  });

  it("a named sub-agent stays capped at Write under an Admin key", async () => {
    await testDb.db.update(agents).set({ accessLevel: "admin" }).where(eq(agents.id, ws.scout.agentId));
    const admin = (await authenticateAgentToken(testDb.db, ws.scout.token))!;
    expect((await resolveNamedSubagent(testDb.db, admin, "Helper"))?.agent.level).toBe("write");
  });

  it("a Read credential cannot start a named sub-agent, and acts as itself", async () => {
    await testDb.db.update(agents).set({ accessLevel: "read" }).where(eq(agents.id, ws.closer.agentId));
    const reader = (await authenticateAgentToken(testDb.db, ws.closer.token))!;
    expect(await resolveNamedSubagent(testDb.db, reader, "Helper")).toEqual(reader);
    expect(await testDb.db.select().from(agents).where(eq(agents.parentAgentId, ws.closer.agentId))).toEqual([]);
    expect(await eventsOf(ws.closer.agentId)).toEqual(["agent.created"]);

    const { agent } = await approveAgent(miaCtx, { name: "Reader", ...grant, level: "read" });
    const oauthReader = (await resolveOAuthAgent(testDb.db, agent.id))!;
    expect(await resolveNamedSubagent(testDb.db, oauthReader, "Helper")).toEqual(oauthReader);
    expect(await testDb.db.select().from(agents).where(eq(agents.parentAgentId, agent.id))).toEqual([]);
  });

  it("a named sub-agent that already exists keeps resolving at Read when its parent drops to Read", async () => {
    const writer = (await authenticateAgentToken(testDb.db, ws.closer.token))!;
    const helper = await resolveNamedSubagent(testDb.db, writer, "Helper");
    expect(helper?.agent.level).toBe("write");

    await testDb.db.update(agents).set({ accessLevel: "read" }).where(eq(agents.id, ws.closer.agentId));
    const reader = (await authenticateAgentToken(testDb.db, ws.closer.token))!;
    const again = await resolveNamedSubagent(testDb.db, reader, "Helper");
    expect(again?.agent).toEqual({ id: helper!.agent.id, name: "Helper", level: "read" });
  });
});

describe("revoking an agent", () => {
  it("a member revokes their own agent but not another's", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    const { agent: theirs } = await approveAgent(owner, { name: "Theirs", ...grant });
    await expect(revokeAgent(miaCtx, { agentId: theirs.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(revokeAgent(miaCtx, { agentId: ws.scout.agentId })).rejects.toMatchObject({ code: "forbidden" });
    expect((await rowOf(theirs.id)).revokedAt).toBeNull();

    await expect(revokeAgent(miaCtx, { agentId: agent.id })).resolves.toMatchObject({ id: agent.id });
    expect((await rowOf(agent.id)).revokedAt).toBeInstanceOf(Date);
  });

  it("an owner revokes anyone's agent", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    await expect(revokeAgent(owner, { agentId: agent.id })).resolves.toMatchObject({ id: agent.id });
  });

  it("an admin agent revokes another agent but not itself", async () => {
    const { agent } = await approveAgent(owner, { name: "Lead", ...grant, level: "admin" });
    const lead = await signedIn(agent.id);
    await expect(revokeAgent(lead, { agentId: ws.scout.agentId })).resolves.toMatchObject({ id: ws.scout.agentId });
    await expect(revokeAgent(lead, { agentId: agent.id })).rejects.toMatchObject({ code: "forbidden" });
    expect((await rowOf(agent.id)).revokedAt).toBeNull();
  });

  it("a write agent revokes only its own sub-agents, and a read agent none", async () => {
    const { agent: worker } = await createSubagent(ws.scout.ctx, { name: "Worker" });
    await expect(revokeAgent(ws.closer.ctx, { agentId: worker.id })).rejects.toMatchObject({ code: "forbidden" });
    await expect(revokeAgent(ws.scout.ctx, { agentId: ws.closer.agentId })).rejects.toMatchObject({ code: "forbidden" });
    await expect(revokeAgent(ws.scout.ctx, { agentId: ws.scout.agentId })).rejects.toMatchObject({ code: "forbidden" });
    await expect(revokeAgent(ws.scout.ctx, { agentId: worker.id })).resolves.toMatchObject({ id: worker.id });

    const { agent: reader } = await approveAgent(miaCtx, { name: "Reader", ...grant, level: "read" });
    const { agent: child } = await createAgent(owner, { name: "Child", parentAgentId: reader.id });
    await expect(revokeAgent(await signedIn(reader.id), { agentId: child.id })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("cuts off the agent's tokens and each sub-agent's, in the same transaction", async () => {
    const { agent } = await approveAgent(miaCtx, { name: "Laptop", ...grant });
    const { agent: worker, token } = await createSubagent(await signedIn(agent.id), { name: "Worker" });

    revoker.mockRejectedValueOnce(new Error("no"));
    await expect(revokeAgent(miaCtx, { agentId: agent.id })).rejects.toThrow("no");
    expect((await rowOf(agent.id)).revokedAt).toBeNull();
    expect(await authenticateAgentToken(testDb.db, token)).not.toBeNull();

    revoker.mockClear();
    await revokeAgent(miaCtx, { agentId: agent.id });
    expect(revoker.mock.calls.map((call) => call[1]).sort()).toEqual([agent.id, worker.id].sort());
    expect((await rowOf(worker.id)).revokedAt).toBeInstanceOf(Date);
    expect(await authenticateAgentToken(testDb.db, token)).toBeNull();
  });
});
