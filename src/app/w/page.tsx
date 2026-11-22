import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isWorkspaceSlug, LAST_WORKSPACE_COOKIE } from "@/lib/last-workspace";
import { routes } from "@/lib/routes";
import { getViewer, visibleWorkspaces } from "@/server/auth/session";

/**
 * `/w`: the way into the app. It opens the workspace the person last had open, if they can still
 * see it, and otherwise their list of workspaces.
 */
export default async function OpenApp(): Promise<never> {
  const viewer = await getViewer();
  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const workspace = isWorkspaceSlug(last) ? (await visibleWorkspaces(viewer)).find((entry) => entry.tenant.slug === last) : undefined;
  redirect(workspace ? routes.workspace(workspace.tenant.slug) : routes.workspaces());
}
