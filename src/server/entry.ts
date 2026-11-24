import "server-only";

import { auth, workspaceResourceMetadata } from "./auth/auth";
import { visibleWorkspaces, type Viewer } from "./auth/session";
import { getDb } from "./db/client";
import { sendDueDigests, type DigestRunReport } from "./digest/send";
import { personContext, type PersonCtx } from "./domain/context";
import { getWorkspaceOverviews, findInvitation, type InvitationView, type WorkspaceOverview } from "./domain/tenants";
import { createPheanMcpHandler } from "./mcp/handler";
import { pingDatabase } from "./db/health";
import { sweepPipelines, type SweepReport } from "./domain/pipeline-engine";
import { handlePipelineTrigger } from "./pipelines/trigger";
import { prunePushDeliveries, sendDuePushes } from "./push/dispatch";
import { handleInbox } from "./push/http";
import { dispatchDue, pruneDeliveries, type DispatchReport } from "./webhooks/dispatch";
import { ensureBackofficeIndexes } from "./backoffice/indexes";
import { rollUpUsage, type RollupReport } from "./backoffice/rollup";

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

/** The cron run that sends due Decision notifications and prunes old ones. */
export async function dispatchPushesNow(): Promise<Awaited<ReturnType<typeof sendDuePushes>>> {
  const db = getDb();
  const report = await sendDuePushes(db);
  await prunePushDeliveries(db);
  return report;
}

/** A signed-in person's context on the shared connection, for the services under /account. */
export const personCtx = (person: { id: string; name: string }): PersonCtx => personContext(getDb(), person);

/** The native apps' inbox feed, on the shared connection. */
export const nativeInbox = (request: Request, options: Omit<Parameters<typeof handleInbox>[1], "db">): Promise<Response> =>
  handleInbox(request, { ...options, db: getDb() });

/** A workspace MCP URL's protected-resource metadata. */
export const workspaceMcpMetadata = () => workspaceResourceMetadata(auth, getDb);

/** The cron run that applies pipelines' time limits and starts the runs their schedules call for. */
export const sweepPipelinesNow = (): Promise<SweepReport> => sweepPipelines(getDb());

/** A pipeline's inbound webhook, on the shared connection. */
export const pipelineTrigger = (request: Request, pipelineId: string): Promise<Response> => handlePipelineTrigger(request, { db: getDb(), pipelineId });

/** The hourly cron run that rolls the event log up into the backoffice's daily usage counts. */
export async function rollUpUsageNow(): Promise<RollupReport & { indexesBuilt: string[] }> {
  const db = getDb();
  // Outside any transaction, so the indexes build concurrently (see backoffice/indexes.ts).
  const indexesBuilt = await ensureBackofficeIndexes(db);
  return { ...(await rollUpUsage(db)), indexesBuilt };
}
