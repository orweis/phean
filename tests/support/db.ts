import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";

import { slugify, type MemberRole } from "@/lib/domain";
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

/** A user; the email is unique per call, so the same name can be seeded into many workspaces. */
export async function seedUser(db: Db, name: string): Promise<TestUser> {
  const id = randomUUID();
  const person = { id, name, email: `${name.toLowerCase().replace(/\W+/g, ".")}.${id.slice(0, 8)}@example.com` };
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

export interface ConnectedAgent {
  ctx: Ctx;
  token: string;
  agentId: string;
}

/** Issues a real agent token through the service and resolves it the way the MCP endpoint does. */
export async function connectAgent(owner: Ctx, name: string): Promise<ConnectedAgent> {
  const { agent, token } = await createAgent(owner, { name });
  const principal = await authenticateAgentToken(owner.db, token);
  if (!principal) throw new Error("freshly issued token did not authenticate");
  return { ctx: agentContext(owner.db, principal), token, agentId: agent.id };
}

export interface Workspace {
  tenant: Tenant;
  /** The owner (Dana unless named otherwise). */
  human: Ctx;
  scout: ConnectedAgent;
  closer: ConnectedAgent;
}

let workspaces = 0;

/**
 * A new workspace with an owner and two connected agents, Scout and Closer, so a test starts from
 * an empty ledger and never depends on what an earlier test wrote. Many fit in one database.
 */
export async function seedWorkspace(db: Db, { name = "Acme", owner = "Dana" } = {}): Promise<Workspace> {
  const tenant = await seedTenant(db, `${slugify(name)}-${++workspaces}`, name);
  const person = await seedUser(db, owner);
  await addMember(db, tenant, person, "owner");
  const human = asUser(db, tenant, person);
  const [scout, closer] = await Promise.all([connectAgent(human, "Scout"), connectAgent(human, "Closer")]);
  return { tenant, human, scout, closer };
}
