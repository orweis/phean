import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { agents } from "@/server/db/schema";
import { authenticateAgentToken, createAgent, generateAgentToken, revokeAgent } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";

import { asUser, createTestDb, seedTenant, seedUser, type TestDb } from "./support/db";

let testDb: TestDb;
let owner: Ctx;

beforeAll(async () => {
  testDb = await createTestDb();
  const tenant = await seedTenant(testDb.db, "acme");
  owner = asUser(testDb.db, tenant, await seedUser(testDb.db, "Owner"));
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
    const { agent, token } = await createAgent(owner, { name: "Scout" });
    expect(agent.lastSeenAt).toBeNull();

    const principal = await authenticateAgentToken(testDb.db, token);
    expect(principal).toEqual({ agent: { id: agent.id, name: "Scout" }, tenant: owner.tenant });
    const [row] = await testDb.db.select().from(agents).where(eq(agents.id, agent.id));
    expect(row?.lastSeenAt).toBeInstanceOf(Date);

    expect(await authenticateAgentToken(testDb.db, `${token}x`)).toBeNull();
    expect(await authenticateAgentToken(testDb.db, "not-a-phean-token")).toBeNull();

    await revokeAgent(owner, { agentId: agent.id });
    expect(await authenticateAgentToken(testDb.db, token)).toBeNull();
  });
});
