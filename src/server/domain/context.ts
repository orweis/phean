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

export function createdByFields(actor: Actor) {
  return { createdByType: actor.type, createdById: actor.id, createdByName: actor.name } as const;
}
