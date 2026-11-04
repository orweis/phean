import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { WatchedEntityType } from "@/lib/domain";

import { publicColumns } from "../db/columns";
import { newId } from "../db/ids";
import { events, goals, memories, tasks, watches, webhookDeliveries, webhooks, type WebhookRow } from "../db/schema";
import { defaultDispatchDeps, postSigned, type DispatchDeps } from "../webhooks/dispatch";
import { decryptSecret, encryptSecret, newWebhookSecret } from "../webhooks/signing";
import { assertWebhookUrlSafe, allowPrivateWebhooks, resolveHost, UnsafeWebhookUrl } from "../webhooks/url-safety";
import { inTenant, inTransaction, tenantRow, type Ctx } from "./context";
import { invalid, notFound } from "./errors";
import { recordEvent } from "./events";
import { assertCan } from "./policy";
import { Empty, ListWatchesInput, RegisterWebhookInput, WatchInput, WebhookRefInput } from "./schemas";
import { service } from "./service";

/** A webhook as agents and people see it: never its secret. */
export type Webhook = Omit<WebhookRow, "tenantId" | "secretCiphertext" | "headersCiphertext" | "leaseUntil">;
const webhookColumns = publicColumns(webhooks, ["tenantId", "secretCiphertext", "headersCiphertext", "leaseUntil"]);

/** Custom headers as stored: encrypted together, with their names kept in the clear for display. */
function storedHeaders(headers: Record<string, string>) {
  const names = Object.keys(headers);
  return names.length ? { headersCiphertext: encryptSecret(JSON.stringify(headers)), headerNames: names } : { headersCiphertext: null, headerNames: [] };
}

/** The custom headers a webhook sends, decrypted for one request. */
export function readHeaders(ciphertext: string | null): Record<string, string> {
  return ciphertext ? (JSON.parse(decryptSecret(ciphertext)) as Record<string, string>) : {};
}

function agentOnly(ctx: Ctx, instead: string): string {
  if (ctx.actor.type !== "agent") throw invalid(instead);
  return ctx.actor.id;
}

/** Whose webhook a call is about: an agent's own, or, for owners and admins, the agent named. */
function targetAgent(ctx: Ctx, agentId: string | undefined): string {
  if (ctx.actor.type === "agent") {
    if (agentId && agentId !== ctx.actor.id) throw invalid("Agents manage only their own webhook.");
    return ctx.actor.id;
  }
  assertCan(ctx, "agent:manage");
  if (!agentId) throw invalid("Say whose webhook: pass agentId.");
  return agentId;
}

async function checkUrl(url: string): Promise<string> {
  try {
    return (await assertWebhookUrlSafe(url, { allowPrivate: allowPrivateWebhooks(), resolve: resolveHost })).href;
  } catch (error) {
    if (error instanceof UnsafeWebhookUrl) throw invalid(error.message);
    throw error;
  }
}

export interface RegisteredWebhook {
  webhook: Webhook;
  /** Shown once. Verify every request's Phean-Signature header with it. */
  secret: string;
}

/**
 * Registers (or replaces) the acting agent's webhook. Each agent has one; registering again
 * changes the URL, topics or scope, rotates the secret, and re-enables a disabled webhook. Custom
 * headers are kept unless `headers` is passed, so rotating the secret never drops the endpoint's key.
 */
export const registerWebhook = service(RegisterWebhookInput, async (ctx, input): Promise<RegisteredWebhook> => {
  assertCan(ctx, "webhook:manage");
  const agentId = agentOnly(ctx, "Agents register webhooks for themselves over MCP.");
  const url = await checkUrl(input.url);
  const secret = newWebhookSecret();
  const fields = {
    url,
    secretCiphertext: encryptSecret(secret),
    topics: [...new Set(input.topics)],
    scope: input.scope,
    status: "active" as const,
    disabledReason: null,
    consecutiveFailures: 0,
    nextAttemptAt: new Date(),
    leaseUntil: null,
    ...(input.headers && storedHeaders(input.headers)),
  };
  return inTransaction(ctx, async (tx) => {
    const [webhook] = await tx.db
      .insert(webhooks)
      .values({ id: newId("wh"), tenantId: tx.tenant.id, agentId, ...fields })
      .onConflictDoUpdate({ target: webhooks.agentId, set: fields })
      .returning(webhookColumns);
    await recordEvent(tx, {
      action: "webhook.registered",
      entityType: "agent",
      entityId: agentId,
      summary: `registered a webhook to ${new URL(url).host}`,
      data: { webhookId: webhook!.id, topics: fields.topics, scope: input.scope, headerNames: webhook!.headerNames },
    });
    return { webhook: webhook!, secret };
  });
});

export interface WebhookStatus {
  webhook: Webhook | null;
  counts: { pending: number; delivered: number; dead: number };
  recent: { eventId: number; action: string; summary: string; status: string; attempts: number; lastError: string | null; createdAt: Date; deliveredAt: Date | null }[];
}

/** An agent's webhook, how its deliveries stand, and the latest of them. */
export const getWebhook = service(WebhookRefInput, async (ctx, { agentId }): Promise<WebhookStatus> => {
  assertCan(ctx, "workspace:read");
  const owner = ctx.actor.type === "agent" ? targetAgent(ctx, agentId) : agentId;
  if (!owner) throw invalid("Say whose webhook: pass agentId.");
  const [webhook] = await ctx.db.select(webhookColumns).from(webhooks).where(and(inTenant(ctx, webhooks), eq(webhooks.agentId, owner)));
  if (!webhook) return { webhook: null, counts: { pending: 0, delivered: 0, dead: 0 }, recent: [] };
  const [counts, recent] = await Promise.all([
    ctx.db
      .select({ status: webhookDeliveries.status, n: sql<number>`count(*)::int` })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhook.id))
      .groupBy(webhookDeliveries.status),
    ctx.db
      .select({
        eventId: webhookDeliveries.eventId,
        action: events.action,
        summary: events.summary,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        lastError: webhookDeliveries.lastError,
        createdAt: webhookDeliveries.createdAt,
        deliveredAt: webhookDeliveries.deliveredAt,
      })
      .from(webhookDeliveries)
      .innerJoin(events, eq(events.id, webhookDeliveries.eventId))
      .where(eq(webhookDeliveries.webhookId, webhook.id))
      .orderBy(desc(webhookDeliveries.id))
      .limit(10),
  ]);
  const byStatus = Object.fromEntries(counts.map((row) => [row.status, row.n]));
  return { webhook, counts: { pending: byStatus.pending ?? 0, delivered: byStatus.delivered ?? 0, dead: byStatus.dead ?? 0 }, recent };
});

/** The webhooks of every agent in the workspace, for the Agents page. */
export const listWebhooks = service(Empty, async (ctx): Promise<Webhook[]> => {
  assertCan(ctx, "workspace:read");
  return ctx.db.select(webhookColumns).from(webhooks).where(inTenant(ctx, webhooks));
});

/** Removes a webhook and anything still waiting to be sent to it. */
export const deleteWebhook = service(WebhookRefInput, async (ctx, { agentId }): Promise<{ removed: boolean }> => {
  assertCan(ctx, "webhook:manage");
  const owner = targetAgent(ctx, agentId);
  return inTransaction(ctx, async (tx) => {
    const [removed] = await tx.db
      .delete(webhooks)
      .where(and(inTenant(tx, webhooks), eq(webhooks.agentId, owner)))
      .returning({ id: webhooks.id });
    if (removed) {
      await recordEvent(tx, { action: "webhook.removed", entityType: "agent", entityId: owner, summary: "removed a webhook", data: { webhookId: removed.id } });
    }
    return { removed: Boolean(removed) };
  });
});

/** Sends a signed test request now and reports what came back. Does not count toward failures. */
export const pingWebhook = service(Empty, (ctx) => pingWith(ctx, defaultDispatchDeps()));

export async function pingWith(ctx: Ctx, deps: Pick<DispatchDeps, "fetch" | "resolve" | "allowPrivate">) {
  assertCan(ctx, "webhook:manage");
  const agentId = agentOnly(ctx, "Agents ping their own webhook over MCP.");
  const [webhook] = await ctx.db
    .select({ id: webhooks.id, url: webhooks.url, secretCiphertext: webhooks.secretCiphertext, headersCiphertext: webhooks.headersCiphertext, status: webhooks.status })
    .from(webhooks)
    .where(and(inTenant(ctx, webhooks), eq(webhooks.agentId, agentId)));
  if (!webhook) throw notFound("webhook for this agent", agentId);
  const deliveryId = `dl_ping_${Date.now()}`;
  const body = JSON.stringify({
    type: "phean.ping",
    deliveryId,
    webhookId: webhook.id,
    workspace: { slug: ctx.tenant.slug, name: ctx.tenant.name },
    agent: { id: agentId, name: ctx.actor.name },
    sentAt: new Date().toISOString(),
    events: [],
  });
  const result = await postSigned(webhook.url, decryptSecret(webhook.secretCiphertext), body, { webhookId: webhook.id, deliveryId }, deps, readHeaders(webhook.headersCiphertext));
  return { ...result, webhookStatus: webhook.status };
}

const ENTITY_TABLES = { task: tasks, goal: goals, memory: memories } as const;

async function assertEntityExists(ctx: Ctx, type: WatchedEntityType, id: string): Promise<void> {
  const table = ENTITY_TABLES[type];
  const [row] = await ctx.db.select({ id: table.id }).from(table).where(tenantRow(ctx, table, id));
  if (!row) throw notFound(type, id);
}

/** Follow a task, goal or memory, so its changes reach the agent's webhook. */
export const watch = service(WatchInput, async (ctx, { entityType, entityId }) => {
  assertCan(ctx, "webhook:manage");
  const agentId = agentOnly(ctx, "Only agents watch objects; people see changes in the app.");
  await assertEntityExists(ctx, entityType, entityId);
  await ctx.db
    .insert(watches)
    .values({ tenantId: ctx.tenant.id, agentId, entityType, entityId, reason: "manual" })
    .onConflictDoUpdate({ target: [watches.agentId, watches.entityType, watches.entityId], set: { reason: "manual" } });
  return { watching: { entityType, entityId } };
});

export const unwatch = service(WatchInput, async (ctx, { entityType, entityId }) => {
  assertCan(ctx, "webhook:manage");
  const agentId = agentOnly(ctx, "Only agents watch objects.");
  const removed = await ctx.db
    .delete(watches)
    .where(and(inTenant(ctx, watches), eq(watches.agentId, agentId), eq(watches.entityType, entityType), eq(watches.entityId, entityId)))
    .returning({ id: watches.entityId });
  return { removed: removed.length > 0 };
});

export interface WatchView {
  entityType: WatchedEntityType;
  entityId: string;
  title: string | null;
  reason: "auto" | "manual";
  since: Date;
}

/** What the acting agent follows, with each object's title. */
export const listWatches = service(ListWatchesInput, async (ctx, { entityType }): Promise<WatchView[]> => {
  assertCan(ctx, "workspace:read");
  const agentId = agentOnly(ctx, "Only agents watch objects.");
  const rows = await ctx.db
    .select()
    .from(watches)
    .where(and(inTenant(ctx, watches), eq(watches.agentId, agentId), entityType ? eq(watches.entityType, entityType) : undefined))
    .orderBy(desc(watches.createdAt));
  const titles = new Map<string, string>();
  const idsOf = (type: WatchedEntityType) => rows.filter((row) => row.entityType === type).map((row) => row.entityId);
  const [taskRows, goalRows, memoryRows] = await Promise.all([
    idsOf("task").length ? ctx.db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(inTenant(ctx, tasks), inArray(tasks.id, idsOf("task")))) : [],
    idsOf("goal").length ? ctx.db.select({ id: goals.id, title: goals.title }).from(goals).where(and(inTenant(ctx, goals), inArray(goals.id, idsOf("goal")))) : [],
    idsOf("memory").length
      ? ctx.db.select({ id: memories.id, title: memories.content }).from(memories).where(and(inTenant(ctx, memories), inArray(memories.id, idsOf("memory"))))
      : [],
  ]);
  for (const row of [...taskRows, ...goalRows, ...memoryRows]) titles.set(row.id, row.title.slice(0, 120));
  return rows.map((row) => ({ entityType: row.entityType, entityId: row.entityId, title: titles.get(row.entityId) ?? null, reason: row.reason, since: row.createdAt }));
});

/** Revoking an agent stops its webhook at once; the row stays so people can see what it was. */
export async function disableWebhooksOf(ctx: Ctx, agentId: string): Promise<void> {
  await ctx.db
    .update(webhooks)
    .set({ status: "disabled", disabledReason: "The agent was revoked." })
    .where(and(inTenant(ctx, webhooks), eq(webhooks.agentId, agentId)));
}
