import "server-only";

import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { routes } from "@/lib/routes";

import { platformAdminEmails } from "../config";
import { getDb } from "../db/client";
import type { Ctx } from "../domain/context";
import { findTenantBySlug, listAllTenants, listMemberships, userContext, type Membership } from "../domain/tenants";
import { platformContext } from "../backoffice/context";
import { adminPaths } from "../backoffice/paths";
import { platformWorkspaceAccess } from "../backoffice/workspace-access";
import { auth, type Session } from "./auth";

export type SessionUser = Session["user"];

export const getSession = cache(async () => {
  // In this order: prerendering stops at headers(), and reading auth.api first would build the provider, which opens the database.
  const requestHeaders = await headers();
  return auth.api.getSession({ headers: requestHeaders });
});

/**
 * Whether the visitor carries a session cookie, read without touching the database. For public
 * pages (the landing page, docs, blog), which must render while the database is down: they only
 * choose between "Open Phean" and "Get started", and the app checks the session itself.
 */
export async function hasSessionCookie(): Promise<boolean> {
  return Boolean(getSessionCookie(await headers()));
}

/** The session, or null when there is none or the database cannot be reached to check it. */
export async function getSessionIfReachable(): Promise<Awaited<ReturnType<typeof getSession>>> {
  try {
    return await getSession();
  } catch (error) {
    console.error("Could not read the session", error);
    return null;
  }
}

/** The workspaces this person belongs to (not a platform admin's extra view). */
export async function ownMemberships(user: SessionUser): Promise<Membership[]> {
  return listMemberships(getDb(), user.id);
}

/** The context a person acts in within one of their workspaces. */
export function personContext(membership: Membership, user: SessionUser): Ctx {
  return userContext(getDb(), membership, user);
}

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
 * Non-members get the same 404 as a missing workspace, so slugs cannot be probed. A platform admin
 * reads a workspace they are not in only within a "Show content" grant (`platformWorkspaceAccess`);
 * without one they are sent to its backoffice page to give a reason.
 */
export const requireWorkspace = cache(async (slug: string): Promise<WorkspaceAccess> => {
  const viewer = await getViewer();
  let membership = viewer.memberships.find((candidate) => candidate.tenant.slug === slug);
  if (!membership && viewer.platformAdmin) {
    const tenant = await findTenantBySlug(getDb(), slug);
    if (tenant) {
      // A workspace a platform admin does not belong to opens only as the backoffice's content does:
      // with two-factor when required, a reason given for it, and a row in the audit trail.
      const access = await platformWorkspaceAccess(platformContext(getDb(), viewer.user), tenant.id);
      if (access === "granted") membership = { tenant, role: "platform_admin" };
      else if (access !== "not_admin") redirect(adminPaths.workspaceContent(slug));
    }
  }
  if (!membership) notFound();
  return { ctx: userContext(getDb(), membership, viewer.user), viewer, membership };
});
