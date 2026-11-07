import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { AgentAccessLevel, MemberRole } from "@/lib/domain";

import type { Db } from "../db/client";

export type UserRole = MemberRole | "platform_admin";

export const AGENT_ROLES = ["agent_read", "agent_write", "agent_admin"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** The role an agent acts with at an access level. */
export function agentRole(level: AgentAccessLevel): AgentRole {
  return `agent_${level}`;
}

export type Actor =
  | { type: "user"; id: string; name: string; role: UserRole }
  | { type: "agent"; id: string; name: string; role: AgentRole };

export type Role = Actor["role"];

export interface Tenant {
  id: string;
  slug: string;
  name: string;
}

/** Work to run once the surrounding transaction has committed, given the database outside it. */
export type CommitHook = (db: Db) => void;

/** Everything a domain service needs: where to read/write, which tenant, and who is acting. */
export interface Ctx {
  db: Db;
  tenant: Tenant;
  actor: Actor;
  /** Set inside `inTransaction`: queues a hook for after the outermost transaction commits. */
  afterCommit?: (hook: CommitHook) => void;
}

/**
 * Runs `fn` in one database transaction; the callback receives a context bound to it. Hooks queued
 * with `onCommit` run after the outermost transaction commits, and never if it rolls back.
 */
export async function inTransaction<T>(ctx: Ctx, fn: (tx: Ctx) => Promise<T>): Promise<T> {
  // Nested: a savepoint inside the outer transaction, whose commit is the one that counts.
  if (ctx.afterCommit) return ctx.db.transaction((db) => fn({ ...ctx, db }));
  const hooks: CommitHook[] = [];
  const result = await ctx.db.transaction((db) => fn({ ...ctx, db, afterCommit: (hook) => hooks.push(hook) }));
  for (const hook of hooks) hook(ctx.db);
  return result;
}

/** Runs `hook` once the work done through `ctx` is durable: now, or after its transaction commits. */
export function onCommit(ctx: Ctx, hook: CommitHook): void {
  if (ctx.afterCommit) ctx.afterCommit(hook);
  else hook(ctx.db);
}

interface TenantOwned {
  tenantId: PgColumn;
}

/** Rows of `table` in the acting tenant. Every query on tenant-owned data filters through this. */
export function inTenant(ctx: Ctx, table: TenantOwned): SQL {
  return eq(table.tenantId, ctx.tenant.id);
}

/** The row with `id`, if it is in the acting tenant: an id from another tenant matches nothing. */
export function tenantRow(ctx: Ctx, table: TenantOwned & { id: PgColumn }, id: string): SQL {
  return and(inTenant(ctx, table), eq(table.id, id))!;
}

export function createdByFields(actor: Actor) {
  return { createdByType: actor.type, createdById: actor.id, createdByName: actor.name } as const;
}
