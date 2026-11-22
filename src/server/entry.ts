import "server-only";

import { auth, workspaceResourceMetadata } from "./auth/auth";
import { visibleWorkspaces, type Viewer } from "./auth/session";
import { getDb } from "./db/client";
import { sendDueDigests, type DigestRunReport } from "./digest/send";
import { getWorkspaceOverviews, findInvitation, type InvitationView, type WorkspaceOverview } from "./domain/tenants";
import { createPheanMcpHandler } from "./mcp/handler";
import { pingDatabase } from "./db/health";
import { dispatchDue, pruneDeliveries, type DispatchReport } from "./webhooks/dispatch";

/**
 * Where pages and route handlers reach server work that needs the database. They never open it
 * themselves (`@/server/db` and the query builder are out of bounds in `src/app` and
 * `src/components`, see eslint.config.mjs): these bind the shared connection to the services, which
 * take it as a parameter so tests can hand them their own.
 */

/** Whether the database answers, for the health check. */
export const databaseReachable = (): Promise<boolean> => pingDatabase(getDb());

/** The overview row of every workspace the viewer can open. */
export async function workspaceOverviews(viewer: Viewer): Promise<WorkspaceOverview[]> {
  return getWorkspaceOverviews(getDb(), await visibleWorkspaces(viewer));
}

/** An invitation by id, for its page. */
export const invitationById = (id: string): Promise<InvitationView | null> => findInvitation(getDb(), id);

/** The cron run that emails the digests whose hour it is. */
export const sendDigestsNow = (): Promise<DigestRunReport> => sendDueDigests(getDb());

/** The cron run that sends due webhook deliveries and prunes old ones. */
export async function dispatchWebhooksNow(): Promise<DispatchReport> {
  const db = getDb();
  const report = await dispatchDue(db);
  await pruneDeliveries(db);
  return report;
}

/** The MCP endpoint's handler, on the shared connection. */
export const mcpHandler = () => createPheanMcpHandler({ getDb });

/** A workspace MCP URL's protected-resource metadata. */
export const workspaceMcpMetadata = () => workspaceResourceMetadata(auth, getDb);
