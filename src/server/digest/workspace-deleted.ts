import { routes } from "@/lib/routes";

import type { Email } from "./email";

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The light appearance's ink and muted, as literal colours: mail clients ignore custom properties. */
const INK = "#1f1530";
const MUTED = "#615a74";

/**
 * Tells a member that the workspace's owner deleted it, with everything in it. It names the
 * workspace and who deleted it, nothing that was in it.
 */
export function renderWorkspaceDeletedEmail({ to, workspace, deletedBy, baseUrl }: { to: string; workspace: string; deletedBy: string; baseUrl: string }): Email {
  const workspaces = `${baseUrl}${routes.workspaces()}`;
  const text = `${deletedBy} deleted the workspace ${workspace} in Phean. Its tasks, goals, decisions, documents, memories, agents and pipelines were deleted with it, and you are no longer a member.\n\nYour other workspaces: ${workspaces}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f5fb;font-family:-apple-system,'Segoe UI',Inter,sans-serif;color:${INK}">
<p style="margin:0 0 12px;font-size:15px;line-height:22px"><strong>${escape(deletedBy)}</strong> deleted the workspace <strong>${escape(workspace)}</strong> in Phean.</p>
<p style="margin:0 0 12px;font-size:14px;line-height:20px;color:${MUTED}">Its tasks, goals, decisions, documents, memories, agents and pipelines were deleted with it, and you are no longer a member.</p>
<p style="margin:0;font-size:14px"><a href="${workspaces}" style="color:${INK}">Your other workspaces</a></p>
</body></html>`;
  return { to, subject: `${workspace} was deleted`, html, text };
}
