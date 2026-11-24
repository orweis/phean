import { and, eq, gte } from "drizzle-orm";

import { backofficeAudit } from "../db/schema";
import { contentGrant, recordAudit } from "./audit";
import { platformAdminRefusal, type PlatformCtx } from "./context";

/** The audit action for a platform admin opening a workspace's own pages, once per grant. */
export const WORKSPACE_APP_VIEW = "view.workspace_app";

/**
 * Whether a platform admin may open a workspace they are not a member of, in the app (`/w/[slug]`),
 * read-only. The same gate as the backoffice's content: a platform admin now (with two-factor when
 * required), and a live "Show content" grant for this workspace by this admin. The first visit
 * within a grant is recorded (`view.workspace_app`); later requests under the same grant are not,
 * so a refreshing page does not flood the trail.
 */
export async function platformWorkspaceAccess(ctx: PlatformCtx, tenantId: string, now = new Date()): Promise<"granted" | "needs_grant" | "two_factor" | "not_admin"> {
  const refusal = await platformAdminRefusal(ctx);
  if (refusal) return refusal;
  const grant = await contentGrant(ctx, tenantId, now);
  if (!grant) return "needs_grant";
  const [seen] = await ctx.db
    .select({ id: backofficeAudit.id })
    .from(backofficeAudit)
    .where(
      and(
        eq(backofficeAudit.adminUserId, ctx.admin.id),
        eq(backofficeAudit.tenantId, tenantId),
        eq(backofficeAudit.action, WORKSPACE_APP_VIEW),
        gte(backofficeAudit.at, grant.at),
      ),
    )
    .limit(1);
  if (!seen) await recordAudit(ctx, { action: WORKSPACE_APP_VIEW, tenantId, reason: grant.reason });
  return "granted";
}
