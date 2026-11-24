"use server";

import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/action-state";
import { routes, safeNextPath } from "@/lib/routes";
import { attempt } from "@/server/actions";
import { queueAnalyticsSignal } from "@/server/auth/analytics";
import { ownMemberships, requireUser } from "@/server/auth/session";
import { acceptInvitation, createWorkspace } from "@/server/auth/workspaces";
import { CreateWorkspaceInput, InvitationRefInput } from "@/server/domain/schemas";
import { formToInput } from "@/server/forms";

export async function createWorkspaceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const result = await attempt(() => createWorkspace(formToInput(formData, CreateWorkspaceInput)));
  if (!result.ok) return result.state;
  await queueAnalyticsSignal({ event: "workspace_create" });
  redirect(safeNextPath(formData.get("next")?.toString(), routes.workspace(result.value.slug)));
}

export async function acceptInvitationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const result = await attempt(() => acceptInvitation(formToInput(formData, InvitationRefInput)));
  if (!result.ok) return result.state;
  await queueAnalyticsSignal({ event: "invite_accept", role: result.value.role });
  const joined = (await ownMemberships(user)).find(
    (membership) => membership.tenant.id === result.value.organizationId,
  );
  redirect(joined ? routes.workspace(joined.tenant.slug) : routes.workspaces());
}
