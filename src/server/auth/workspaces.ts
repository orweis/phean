import "server-only";

import { headers } from "next/headers";
import type { z } from "zod";

import type { Tenant } from "../domain/context";
import { recordEvent } from "../domain/events";
import { assertCan } from "../domain/policy";
import {
  CreateWorkspaceInput,
  InvitationRefInput,
  InviteMemberInput,
  MemberRefInput,
} from "../domain/schemas";
import { parseInput, service } from "../domain/service";
import { auth } from "./auth";

/**
 * Workspace membership lives in Better Auth's organization plugin, so these operations
 * call its API with the caller's session. Phean's policy is checked first so the
 * rules (and messages) match the rest of the app.
 */

export async function createWorkspace(input: z.input<typeof CreateWorkspaceInput>): Promise<Tenant> {
  const { name, slug } = parseInput(CreateWorkspaceInput, input);
  const created = await auth.api.createOrganization({ body: { name, slug }, headers: await headers() });
  if (!created) throw new Error("Better Auth did not return the new organization");
  return { id: created.id, slug: created.slug, name: created.name };
}

export const inviteMember = service(InviteMemberInput, async (ctx, { email, role }) => {
  assertCan(ctx, "member:manage");
  const invitation = await auth.api.createInvitation({
    body: { email, role, organizationId: ctx.tenant.id },
    headers: await headers(),
  });
  await recordEvent(ctx, {
    action: "member.invited",
    entityType: "member",
    entityId: invitation.id,
    summary: `invited ${email} as ${role}`,
  });
  return { id: invitation.id, email };
});

export const cancelInvitation = service(InvitationRefInput, async (ctx, { invitationId }) => {
  assertCan(ctx, "member:manage");
  await auth.api.cancelInvitation({ body: { invitationId }, headers: await headers() });
  return { cancelled: invitationId };
});

export const removeMember = service(MemberRefInput, async (ctx, { memberId }) => {
  assertCan(ctx, "member:manage");
  await auth.api.removeMember({
    body: { memberIdOrEmail: memberId, organizationId: ctx.tenant.id },
    headers: await headers(),
  });
  return { removed: memberId };
});

/** Joins the invited workspace; Better Auth checks the invitation is pending and addressed to this user. */
export async function acceptInvitation(input: z.input<typeof InvitationRefInput>): Promise<{ organizationId: string }> {
  const { invitationId } = parseInput(InvitationRefInput, input);
  const result = await auth.api.acceptInvitation({ body: { invitationId }, headers: await headers() });
  if (!result) throw new Error("Better Auth did not return the accepted invitation");
  return { organizationId: result.invitation.organizationId };
}
