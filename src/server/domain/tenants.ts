import { and, asc, count, eq, gt } from "drizzle-orm";

import type { MemberRole } from "@/lib/domain";

import type { Db } from "../db/client";
import { invitation, member, organization, user } from "../db/schema";
import type { Ctx, Tenant, UserRole } from "./context";
import { getWorkspaceStats, type WorkspaceStats } from "./overview";
import { assertCan } from "./policy";
import { Empty } from "./schemas";
import { service } from "./service";

export interface Membership {
  tenant: Tenant;
  role: UserRole;
}

const tenantColumns = { id: organization.id, slug: organization.slug, name: organization.name };

/** Better Auth stores roles as a comma-separated list (or none); Phean uses the most privileged one. */
export function toMemberRole(raw: string | null): MemberRole {
  const roles = (raw ?? "").split(",").map((role) => role.trim());
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}

export function userContext(db: Db, membership: Membership, person: { id: string; name: string }): Ctx {
  return { db, tenant: membership.tenant, actor: { type: "user", id: person.id, name: person.name, role: membership.role } };
}

export async function listMemberships(db: Db, userId: string): Promise<Membership[]> {
  const rows = await db
    .select({ tenant: tenantColumns, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));
  return rows.map((row) => ({ tenant: row.tenant, role: toMemberRole(row.role) }));
}

export async function findTenantBySlug(db: Db, slug: string): Promise<Tenant | null> {
  const [tenant] = await db.select(tenantColumns).from(organization).where(eq(organization.slug, slug));
  return tenant ?? null;
}

export async function listAllTenants(db: Db): Promise<Tenant[]> {
  return db.select(tenantColumns).from(organization).orderBy(asc(organization.name));
}

export type WorkspaceOverview = Membership & WorkspaceStats;

/** The "status per customer" view: headline numbers for every workspace the viewer can see. */
export async function getWorkspaceOverviews(db: Db, memberships: readonly Membership[]): Promise<WorkspaceOverview[]> {
  const stats = await getWorkspaceStats(
    db,
    memberships.map((membership) => membership.tenant.id),
  );
  return memberships.map((membership) => ({ ...membership, ...stats.get(membership.tenant.id)! }));
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: Date;
}

export const listMembers = service(Empty, async (ctx): Promise<Member[]> => {
  assertCan(ctx, "workspace:read");
  const rows = await ctx.db
    .select({
      id: member.id,
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, ctx.tenant.id))
    .orderBy(asc(member.createdAt));
  return rows.map((row) => ({ ...row, role: toMemberRole(row.role) }));
});

export interface PendingInvitation {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
}

export const listPendingInvitations = service(Empty, async (ctx): Promise<PendingInvitation[]> => {
  assertCan(ctx, "member:manage");
  const rows = await ctx.db
    .select({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, ctx.tenant.id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(invitation.createdAt));
  return rows.map((row) => ({ ...row, role: toMemberRole(row.role) }));
});

export interface InvitationView {
  id: string;
  email: string;
  role: MemberRole;
  status: string;
  expiresAt: Date;
  tenant: Tenant;
  inviterName: string;
}

/** An invitation as shown on its share link; the id itself is the unguessable capability. */
export async function findInvitation(db: Db, invitationId: string): Promise<InvitationView | null> {
  const [row] = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      tenant: tenantColumns,
      inviterName: user.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(eq(invitation.id, invitationId));
  return row ? { ...row, role: toMemberRole(row.role) } : null;
}

export async function countMembers(db: Db, tenantId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(member).where(eq(member.organizationId, tenantId));
  return row?.n ?? 0;
}
