import { count } from "drizzle-orm";
import { z } from "zod";

import { BACKOFFICE_PAGE_SIZE } from "@/lib/backoffice";

import { backofficeAudit } from "../db/schema";
import { auditRows } from "./audit";
import { platformService } from "./service";

/** The backoffice's audit trail, newest first. Reading it is recorded too. */
export const listAuditLog = platformService("view.audit", z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }), async (ctx, { page }) => {
  const [rows, [total]] = await Promise.all([auditRows(ctx, (page - 1) * BACKOFFICE_PAGE_SIZE, BACKOFFICE_PAGE_SIZE), ctx.db.select({ value: count() }).from(backofficeAudit)]);
  return { rows, total: total?.value ?? 0, page, pageSize: BACKOFFICE_PAGE_SIZE };
});
