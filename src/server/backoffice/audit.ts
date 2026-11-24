import { and, desc, eq, gte } from "drizzle-orm";

import { CONTENT_GRANT_MINUTES } from "@/lib/backoffice";

import { backofficeAudit, organization, user } from "../db/schema";
import type { PlatformCtx } from "./context";

export interface AuditEntry {
  action: string;
  filters?: Record<string, unknown>;
  tenantId?: string;
  subjectUserId?: string;
  reason?: string;
}

/** Writes one row of the backoffice's audit trail, as the admin in `ctx`. */
export async function recordAudit(ctx: PlatformCtx, entry: AuditEntry): Promise<void> {
  await ctx.db.insert(backofficeAudit).values({
    adminUserId: ctx.admin.id,
    adminEmail: ctx.admin.email,
    action: entry.action,
    filters: entry.filters ?? {},
    tenantId: entry.tenantId ?? null,
    subjectUserId: entry.subjectUserId ?? null,
    reason: entry.reason ?? null,
  });
}

/** The audit action a "Show content" records; its row is the grant `contentGrant` looks for. */
export const CONTENT_REVEAL = "content.reveal";

/**
 * Until when this admin may read a workspace's content: the latest "Show content" they recorded for
 * it, plus `CONTENT_GRANT_MINUTES`; null when there is none that recent. Per admin and per workspace.
 */
export async function contentGrant(ctx: PlatformCtx, tenantId: string, now = new Date()): Promise<{ at: Date; until: Date; reason: string } | null> {
  const since = new Date(now.getTime() - CONTENT_GRANT_MINUTES * 60_000);
  const [row] = await ctx.db
    .select({ at: backofficeAudit.at, reason: backofficeAudit.reason })
    .from(backofficeAudit)
    .where(
      and(
        eq(backofficeAudit.adminUserId, ctx.admin.id),
        eq(backofficeAudit.tenantId, tenantId),
        eq(backofficeAudit.action, CONTENT_REVEAL),
        gte(backofficeAudit.at, since),
      ),
    )
    .orderBy(desc(backofficeAudit.at))
    .limit(1);
  return row ? { at: row.at, until: new Date(row.at.getTime() + CONTENT_GRANT_MINUTES * 60_000), reason: row.reason ?? "" } : null;
}

/** Rows of the trail, newest first. */
export async function auditRows(ctx: PlatformCtx, offset: number, limit: number) {
  const rows = await ctx.db
    .select({
      id: backofficeAudit.id,
      at: backofficeAudit.at,
      adminEmail: backofficeAudit.adminEmail,
      action: backofficeAudit.action,
      tenantId: backofficeAudit.tenantId,
      subjectUserId: backofficeAudit.subjectUserId,
      filters: backofficeAudit.filters,
      reason: backofficeAudit.reason,
      tenantSlug: organization.slug,
      tenantName: organization.name,
      subjectEmail: user.email,
    })
    .from(backofficeAudit)
    .leftJoin(organization, eq(organization.id, backofficeAudit.tenantId))
    .leftJoin(user, eq(user.id, backofficeAudit.subjectUserId))
    .orderBy(desc(backofficeAudit.at), desc(backofficeAudit.id))
    .limit(limit)
    .offset(offset);
  return rows;
}
