import { count, desc } from "drizzle-orm";
import { z } from "zod";

import { BACKOFFICE_PAGE_SIZE } from "@/lib/backoffice";

import { backofficeAudit, workspaceDeletions } from "../db/schema";
import { auditRows } from "./audit";
import { platformService } from "./service";

/** How many deleted workspaces the Audit page lists, newest first. */
const DELETIONS_SHOWN = 50;

/**
 * The backoffice's audit trail, newest first, and the workspaces their owners deleted (who, which,
 * how much, and whether their files have left the blob store). Reading it is recorded too.
 */
export const listAuditLog = platformService("view.audit", z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }), async (ctx, { page }) => {
  const [rows, [total], deletions] = await Promise.all([
    auditRows(ctx, (page - 1) * BACKOFFICE_PAGE_SIZE, BACKOFFICE_PAGE_SIZE),
    ctx.db.select({ value: count() }).from(backofficeAudit),
    ctx.db
      .select({
        id: workspaceDeletions.id,
        at: workspaceDeletions.at,
        tenantId: workspaceDeletions.tenantId,
        name: workspaceDeletions.name,
        slug: workspaceDeletions.slug,
        deletedByEmail: workspaceDeletions.deletedByEmail,
        counts: workspaceDeletions.counts,
        blobsClearedAt: workspaceDeletions.blobsClearedAt,
      })
      .from(workspaceDeletions)
      .orderBy(desc(workspaceDeletions.at), desc(workspaceDeletions.id))
      .limit(DELETIONS_SHOWN),
  ]);
  return { rows, total: total?.value ?? 0, page, pageSize: BACKOFFICE_PAGE_SIZE, deletions };
});
