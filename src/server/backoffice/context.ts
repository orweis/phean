import { eq } from "drizzle-orm";

import { adminTwoFactorRequired, platformAdminEmails } from "../config";
import type { Db } from "../db/client";
import { user } from "../db/schema";
import { forbidden } from "../domain/errors";

/**
 * A platform admin reading the backoffice. Built only from a signed-in session
 * (`requireBackoffice`), never from an agent's credential or from input; there is no tenant, because
 * backoffice reads cross workspaces on purpose. Services check it again (`assertPlatformAdmin`).
 */
export interface PlatformCtx {
  db: Db;
  admin: { id: string; email: string; name: string };
}

export function platformContext(db: Db, admin: { id: string; email: string; name: string }): PlatformCtx {
  return { db, admin: { id: admin.id, email: admin.email, name: admin.name } };
}

/** Why a person may not read the backoffice, or null when they may. */
export type AdminRefusal = "not_admin" | "two_factor";

/**
 * Re-reads the admin's row and refuses anyone who is not a platform admin now: a verified address
 * listed in `PHEAN_PLATFORM_ADMINS`, with two-factor on when `PHEAN_ADMIN_REQUIRE_2FA` asks for it.
 * The row decides, not what the page was handed, so a demotion or an unverified address takes
 * effect on the next call.
 */
export async function platformAdminRefusal(ctx: PlatformCtx): Promise<AdminRefusal | null> {
  const [row] = await ctx.db
    .select({ email: user.email, emailVerified: user.emailVerified, twoFactorEnabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, ctx.admin.id));
  if (!row || !row.emailVerified || !platformAdminEmails().has(row.email.toLowerCase())) return "not_admin";
  if (adminTwoFactorRequired() && !row.twoFactorEnabled) return "two_factor";
  return null;
}

export async function assertPlatformAdmin(ctx: PlatformCtx): Promise<void> {
  const refusal = await platformAdminRefusal(ctx);
  if (refusal === "not_admin") throw forbidden("Only Phean's platform admins can read the backoffice.");
  if (refusal === "two_factor") throw forbidden("Turn on two-factor for your account to read the backoffice.");
}
