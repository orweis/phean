import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { getDb } from "../db/client";
import { getViewer } from "../auth/session";
import { platformAdminRefusal, platformContext, type AdminRefusal, type PlatformCtx } from "./context";

export interface BackofficeAccess {
  ctx: PlatformCtx;
  /** Null when the admin may read; `two_factor` when they must turn it on first. */
  refusal: Exclude<AdminRefusal, "not_admin"> | null;
  twoFactorEnabled: boolean;
}

/**
 * The backoffice's way in, for its pages and its export route: the signed-in person as a
 * `PlatformCtx`, or the same 404 as a missing page for anyone who is not a platform admin, so the
 * console is not advertised. Signed-out visitors are sent to sign in by `requireUser` first.
 */
export const requireBackoffice = cache(async (): Promise<BackofficeAccess> => {
  const { user } = await getViewer();
  const ctx = platformContext(getDb(), user);
  const refusal = await platformAdminRefusal(ctx);
  if (refusal === "not_admin") notFound();
  return { ctx, refusal, twoFactorEnabled: Boolean(user.twoFactorEnabled) };
});
