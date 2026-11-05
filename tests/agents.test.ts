import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { agents } from "@/server/db/schema";
import { authenticateAgentToken, createAgent, generateAgentToken, revokeAgent } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";

import { createTestDb, seedWorkspace, type TestDb } from "./support/db";

let testDb: TestDb;
let owner: Ctx;

beforeAll(async () => {
  testDb = await createTestDb();
  owner = (await seedWorkspace(testDb.db)).human;
});

afterAll(() => testDb.close());

describe("agent tokens", () => {
  it("generates prefixed, high-entropy tokens and stores only their hash", async () => {
    const a = generateAgentToken();
    const b = generateAgentToken();
    expect(a.token).toMatch(/^phn_[\w-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
  });

  it("authenticates live tokens, records last seen, and rejects revoked or unknown ones", async () => {
    const { agent, token } = await createAgent(owner, { name: "Runner" });
    expect(agent.lastSeenAt).toBeNull();

    const principal = await authenticateAgentToken(testDb.db, token);
    expect(principal).toEqual({ agent: { id: agent.id, name: "Runner", level: "write" }, tenant: owner.tenant });
    const [row] = await testDb.db.select().from(agents).where(eq(agents.id, agent.id));
    expect(row?.lastSeenAt).toBeInstanceOf(Date);

    expect(await authenticateAgentToken(testDb.db, `${token}x`)).toBeNull();
    expect(await authenticateAgentToken(testDb.db, "not-a-phean-token")).toBeNull();

    await revokeAgent(owner, { agentId: agent.id });
    expect(await authenticateAgentToken(testDb.db, token)).toBeNull();
  });
});

describe("agent access levels", () => {
  it("stores sub-agents at the lower of their parent's level and write", async () => {
    const { agent: parent } = await createAgent(owner, { name: "Lead" });
    await testDb.db.update(agents).set({ accessLevel: "admin" }).where(eq(agents.id, parent.id));
    const { agent: child } = await createAgent(owner, { name: "Worker", parentAgentId: parent.id });
    expect(child.accessLevel).toBe("write");

    await testDb.db.update(agents).set({ accessLevel: "read" }).where(eq(agents.id, parent.id));
    const { agent: reader } = await createAgent(owner, { name: "Peeker", parentAgentId: parent.id });
    expect(reader.accessLevel).toBe("read");
  });
});
