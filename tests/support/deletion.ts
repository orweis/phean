import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { queryRows } from "@/server/db/raw";
import * as schema from "@/server/db/schema";
import type { DeletionProof, Reauth } from "@/server/domain/workspace-deletion";

/** Every table in the schema with a column naming a workspace (`tenant_id`, or Better Auth's `organization_id`). */
export function tablesWithWorkspaceColumn(): { name: string; column: string; table: PgTable }[] {
  return (Object.values(schema) as unknown[])
    .filter((value: unknown): value is PgTable => is(value, PgTable))
    .flatMap((table) => {
      const config = getTableConfig(table);
      const column = config.columns.find((candidate) => candidate.name === "tenant_id" || candidate.name === "organization_id");
      return column ? [{ name: config.name, column: column.name, table }] : [];
    });
}

/** Each such table's rows for one workspace, as JSON text, sorted: what "untouched, row for row" compares. */
export async function workspaceRows(db: Db, tenantId: string): Promise<Record<string, string[]>> {
  const snapshot: Record<string, string[]> = {};
  for (const { name, column } of tablesWithWorkspaceColumn()) {
    const rows = await queryRows<{ row: string }>(db, sql`select to_jsonb(t)::text as row from ${sql.identifier(name)} t where ${sql.identifier(column)} = ${tenantId} order by 1`);
    snapshot[name] = rows.map((row) => row.row);
  }
  return snapshot;
}

/** Re-authentication that accepts anyone, for tests about who may delete rather than how they prove it. */
export const trustingReauth: Reauth = {
  factors: async () => ({ password: false, twoFactor: false }),
  verifyPassword: async () => true,
  verifySecondFactor: async () => true,
};

/** A proof from a session made just now, with `reauth` (trusting by default). */
export function freshProof(reauth: Reauth = trustingReauth, extra: Partial<DeletionProof> = {}): DeletionProof {
  return { reauth, signedInAt: new Date(), ...extra };
}
