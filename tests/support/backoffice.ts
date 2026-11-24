import { randomUUID } from "node:crypto";

import type { Db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import * as backoffice from "@/server/backoffice";
import { platformContext, type PlatformCtx } from "@/server/backoffice/context";

/** The address tests list in PHEAN_PLATFORM_ADMINS. */
export const ADMIN_EMAIL = "ops@phean.example";

/** A person who may be a platform admin: listed and verified by default; pass options to take either away. */
export async function seedPlatformAdmin(db: Db, { verified = true, email = ADMIN_EMAIL, twoFactor = false } = {}): Promise<PlatformCtx> {
  const admin = { id: randomUUID(), name: "Opal Ops", email };
  await db.insert(user).values({ ...admin, emailVerified: verified, twoFactorEnabled: twoFactor });
  return platformContext(db, admin);
}

/** Every backoffice service with an input it accepts, so a test can refuse each in turn. */
export function everyBackofficeCall(slug: string): [string, (ctx: PlatformCtx) => Promise<unknown>][] {
  return [
    ["getOverview", (ctx) => backoffice.getOverview(ctx, {})],
    ["getActivation", (ctx) => backoffice.getActivation(ctx, {})],
    ["listWorkspaces", (ctx) => backoffice.listWorkspaces(ctx, {})],
    ["exportWorkspaces", (ctx) => backoffice.exportWorkspaces(ctx, {})],
    ["getWorkspaceDetail", (ctx) => backoffice.getWorkspaceDetail(ctx, { slug })],
    ["revealContent", (ctx) => backoffice.revealContent(ctx, { slug, reason: "Investigating a support ticket" })],
    ["getWorkspaceContent", (ctx) => backoffice.getWorkspaceContent(ctx, { slug })],
    ["searchPeople", (ctx) => backoffice.searchPeople(ctx, { q: "dana" })],
    ["getAgentsReport", (ctx) => backoffice.getAgentsReport(ctx, {})],
    ["getProductUsage", (ctx) => backoffice.getProductUsage(ctx, {})],
    ["getSystemHealth", (ctx) => backoffice.getSystemHealth(ctx, {})],
    ["listAuditLog", (ctx) => backoffice.listAuditLog(ctx, {})],
  ];
}
