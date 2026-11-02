import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";

import type { MemberRole } from "@/lib/domain";
import { createPgliteDb, type Db } from "@/server/db/client";
import { migratePgliteClient } from "@/server/db/migrate";
import { member, organization, user } from "@/server/db/schema";
import { agentContext, authenticateAgentToken, createAgent } from "@/server/domain/agents";
import type { Ctx, Tenant, UserRole } from "@/server/domain/context";

export interface TestDb {
  db: Db;
  close: () => Promise<void>;
}

/** A fresh in-memory Postgres with the real migrations applied. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  await migratePgliteClient(client);
  return { db: createPgliteDb(client), close: () => client.close() };
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
}

export async function seedUser(db: Db, name: string): Promise<TestUser> {
  const person = { id: randomUUID(), name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.com` };
  await db.insert(user).values(person);
  return person;
}

export async function seedTenant(db: Db, slug: string, name = slug): Promise<Tenant> {
  const tenant = { id: randomUUID(), slug, name };
  await db.insert(organization).values({ ...tenant, createdAt: new Date() });
  return tenant;
}

export async function addMember(db: Db, tenant: Tenant, person: TestUser, role: MemberRole): Promise<void> {
  await db
    .insert(member)
    .values({ id: randomUUID(), organizationId: tenant.id, userId: person.id, role, createdAt: new Date() });
}

export function asUser(db: Db, tenant: Tenant, person: TestUser, role: UserRole = "owner"): Ctx {
  return { db, tenant, actor: { type: "user", id: person.id, name: person.name, role } };
}

/** Issues a real agent token through the service and resolves it the way the MCP endpoint does. */
export async function connectAgent(owner: Ctx, name: string): Promise<{ ctx: Ctx; token: string; agentId: string }> {
  const { agent, token } = await createAgent(owner, { name });
  const principal = await authenticateAgentToken(owner.db, token);
  if (!principal) throw new Error("freshly issued token did not authenticate");
  return { ctx: agentContext(owner.db, principal), token, agentId: agent.id };
}

/** Today's date (UTC) shifted by `days`, as YYYY-MM-DD. */
export function isoDay(days = 0): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
