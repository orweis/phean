import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { routes } from "@/lib/routes";

import { platformAdminEmails } from "../config";
import { getDb } from "../db/client";
import type { Ctx } from "../domain/context";
import { findTenantBySlug, listAllTenants, listMemberships, userContext, type Membership } from "../domain/tenants";
import { auth, type Session } from "./auth";

export type SessionUser = Session["user"];

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect(routes.signIn());
  return session.user;
}

/** Operators listed in PHEAN_PLATFORM_ADMINS. Only a verified address counts: anyone can register an unverified one. */
export function isPlatformAdmin(user: SessionUser): boolean {
  return user.emailVerified && platformAdminEmails().has(user.email.toLowerCase());
}

export interface Viewer {
  user: SessionUser;
  /** Workspaces the user belongs to. */
  memberships: Membership[];
  platformAdmin: boolean;
}

export const getViewer = cache(async (): Promise<Viewer> => {
  const user = await requireUser();
  return { user, memberships: await listMemberships(getDb(), user.id), platformAdmin: isPlatformAdmin(user) };
});

/** Everything the viewer can open: their own workspaces, plus every other one (read-only) for platform admins. */
export async function visibleWorkspaces(viewer: Viewer): Promise<Membership[]> {
  if (!viewer.platformAdmin) return viewer.memberships;
  const own = new Set(viewer.memberships.map((membership) => membership.tenant.id));
  const others = (await listAllTenants(getDb()))
    .filter((tenant) => !own.has(tenant.id))
    .map((tenant): Membership => ({ tenant, role: "platform_admin" }));
  return [...viewer.memberships, ...others];
}

export interface WorkspaceAccess {
  ctx: Ctx;
  viewer: Viewer;
  membership: Membership;
}

/**
 * Resolves a workspace slug to a domain context for the signed-in user, or renders 404.
 * Non-members get the same 404 as a missing workspace, so slugs cannot be probed.
 */
export const requireWorkspace = cache(async (slug: string): Promise<WorkspaceAccess> => {
  const viewer = await getViewer();
  let membership = viewer.memberships.find((candidate) => candidate.tenant.slug === slug);
  if (!membership && viewer.platformAdmin) {
    const tenant = await findTenantBySlug(getDb(), slug);
    if (tenant) membership = { tenant, role: "platform_admin" };
  }
  if (!membership) notFound();
  return { ctx: userContext(getDb(), membership, viewer.user), viewer, membership };
});
