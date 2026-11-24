"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/action-state";
import { adminPaths } from "@/server/backoffice/paths";
import { attempt } from "@/server/actions";
import { revealContent } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";
import { formToInput } from "@/server/forms";

/**
 * "Show content" on a workspace's backoffice page: the one form in the backoffice. It changes no
 * customer data; it records the admin's reason, which opens the workspace's content to them for 30 minutes.
 */
export async function revealContentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireBackoffice();
  const result = await attempt(() => revealContent(ctx, formToInput(formData, revealContent.schema) as { slug: string; reason: string }));
  if (!result.ok) return result.state;
  revalidatePath(adminPaths.workspace(result.value.tenant.slug));
  return { status: "success", message: "Content shown for 30 minutes. Your reason is in the audit log.", at: Date.now() };
}
