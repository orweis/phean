import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { MemberRole } from "@/lib/domain";

import type { Db } from "../db/client";

export type UserRole = MemberRole | "platform_admin";

export type Actor =
  | { type: "user"; id: string; name: string; role: UserRole }
  | { type: "agent"; id: string; name: string; role: "agent" };

export type Role = Actor["role"];

export interface Tenant {
  id: string;
  slug: string;
  name: string;
}

/** Everything a domain service needs: where to read/write, which tenant, and who is acting. */
export interface Ctx {
  db: Db;
  tenant: Tenant;
  actor: Actor;
}

/** Runs `fn` in one database transaction; the callback receives a context bound to it. */
export function inTransaction<T>(ctx: Ctx, fn: (tx: Ctx) => Promise<T>): Promise<T> {
  return ctx.db.transaction((db) => fn({ ...ctx, db }));
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
