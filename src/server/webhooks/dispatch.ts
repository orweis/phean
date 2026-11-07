import { and, asc, eq, inArray, lt, not, sql } from "drizzle-orm";

import { routes } from "@/lib/routes";

import { appUrl } from "../config";
import type { Db } from "../db/client";
import { queryRows } from "../db/raw";
import { liveAgent } from "../domain/agent-liveness";
import { agents, events, organization, webhookDeliveries, webhooks, type WebhookRow } from "../db/schema";
import { assertWebhookUrlSafe, allowPrivateWebhooks, resolveHost, type Resolver } from "./url-safety";
import { decryptSecret, SIGNATURE_HEADER, signPayload } from "./signing";

/** Events per request: enough to drain a burst quickly, small enough to process in one go. */
export const BATCH_SIZE = 25;
/** Failed sends in a row after which a webhook is switched off. With the backoff below, about two days. */
export const MAX_CONSECUTIVE_FAILURES = 12;
export const REQUEST_TIMEOUT_MS = 10_000;
/** A dispatcher holds a webhook this long; if it dies mid-send, another takes over after. */
const LEASE_SECONDS = 60;
/** Delivered and dead rows are kept this long for `get_webhook`, then pruned. */
export const RETENTION_DAYS = 7;

/** 30s, 2m, 8m, 32m, ~2h, then every 6h. */
export function backoffSeconds(consecutiveFailures: number): number {
  return Math.min(30 * 4 ** Math.max(0, consecutiveFailures - 1), 6 * 60 * 60);
}

export interface DispatchDeps {
  fetch: typeof fetch;
  resolve: Resolver;
  allowPrivate: boolean;
  /** Absolute links in payloads point here. */
  baseUrl: string;
  /** Stop starting new batches after this long; the cron sweep picks up the rest. */
  budgetMs: number;
}

export const defaultDispatchDeps = (): DispatchDeps => ({
  fetch: globalThis.fetch,
  resolve: resolveHost,
  allowPrivate: allowPrivateWebhooks(),
  baseUrl: appUrl(),
  budgetMs: 25_000,
});

export interface DispatchReport {
  batches: number;
  delivered: number;
  failed: number;
}

interface Claimed {
  id: string;
  tenant_id: string;
  agent_id: string;
  url: string;
  secret_ciphertext: string;
  headers_ciphertext: string | null;
  consecutive_failures: number;
}

/**
 * Takes the lease on webhooks that have pending deliveries and are not backing off. SKIP LOCKED
 * lets any number of dispatchers (after-commit kicks, the cron sweep, several instances) run at
 * once without two of them sending to the same webhook, which keeps each webhook's events in order.
 */
async function claimWebhooks(db: Db, limit: number): Promise<Claimed[]> {
  const live = db.select({ id: agents.id }).from(agents).where(liveAgent());
  return queryRows<Claimed>(
    db,
    sql`
      UPDATE webhooks SET lease_until = now() + make_interval(secs => ${LEASE_SECONDS})
      WHERE id IN (
        SELECT w.id FROM webhooks w
        WHERE w.status = 'active' AND w.agent_id IN (${live}) AND w.next_attempt_at <= now() AND (w.lease_until IS NULL OR w.lease_until < now())
          AND EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'pending')
        ORDER BY w.next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, tenant_id, agent_id, url, secret_ciphertext, headers_ciphertext, consecutive_failures`,
  );
}

/** What `last_error` says on a delivery that was never sent because its agent had no access. */
export const AGENT_INACTIVE = "agent_inactive";

/**
 * A webhook pauses while its agent has no access (expired, or its approver left). What was queued
 * before then is marked dead rather than replayed later. It is not a failed send: the webhook stays
 * active, with no strike toward auto-disable and no backoff, and new events queue again on renewal.
 */
async function dropForInactiveAgents(db: Db): Promise<void> {
  const paused = db
    .select({ id: webhooks.id })
    .from(webhooks)
    .innerJoin(agents, and(eq(agents.tenantId, webhooks.tenantId), eq(agents.id, webhooks.agentId)))
    .where(and(eq(webhooks.status, "active"), not(liveAgent())));
  await db
    .update(webhookDeliveries)
    .set({ status: "dead", lastError: AGENT_INACTIVE })
    .where(and(eq(webhookDeliveries.status, "pending"), inArray(webhookDeliveries.webhookId, paused)));
}

export const eventUrl = (base: string, slug: string, entityType: string, entityId: string, action: string) => {
  const path =
    action === "task.input_answered" || action === "task.input_retracted" || action === "task.input_requested"
      ? routes.decisions(slug)
      : entityType === "goal"
        ? routes.goal(slug, entityId)
        : entityType === "memory"
          ? routes.memory(slug)
          : routes.board(slug);
  return new URL(path, base).toString();
};

export interface WebhookPayload {
  type: "phean.events";
  deliveryId: string;
  webhookId: string;
  workspace: { slug: string; name: string };
  agent: { id: string; name: string };
  sentAt: string;
  events: {
    eventId: number;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    actor: { type: string; id: string; name: string };
    data: Record<string, unknown>;
    createdAt: string;
    reasons: string[];
    url: string;
  }[];
}

async function buildBatch(db: Db, hook: Claimed, deps: DispatchDeps) {
  const rows = await db
    .select({
      deliveryId: webhookDeliveries.id,
      reasons: webhookDeliveries.reasons,
      event: events,
      slug: organization.slug,
      workspaceName: organization.name,
      agentName: agents.name,
    })
    .from(webhookDeliveries)
    .innerJoin(events, eq(events.id, webhookDeliveries.eventId))
    .innerJoin(organization, eq(organization.id, webhookDeliveries.tenantId))
    .innerJoin(agents, eq(agents.id, hook.agent_id))
    .where(and(eq(webhookDeliveries.webhookId, hook.id), eq(webhookDeliveries.status, "pending")))
    .orderBy(asc(webhookDeliveries.eventId))
    .limit(BATCH_SIZE);
  if (rows.length === 0) return null;
  const [first] = rows;
  const payload: WebhookPayload = {
    type: "phean.events",
    deliveryId: `dl_${hook.id.slice(3)}_${rows.at(-1)!.deliveryId}`,
    webhookId: hook.id,
    workspace: { slug: first!.slug, name: first!.workspaceName },
    agent: { id: hook.agent_id, name: first!.agentName },
    sentAt: new Date().toISOString(),
    events: rows.map(({ event, reasons, slug }) => ({
      eventId: event.id,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      summary: `${event.actorName} ${event.summary}`,
      actor: { type: event.actorType, id: event.actorId, name: event.actorName },
      data: event.data,
      createdAt: event.createdAt.toISOString(),
      reasons,
      url: eventUrl(deps.baseUrl, slug, event.entityType, event.entityId, event.action),
    })),
  };
  return { payload, deliveryIds: rows.map((row) => row.deliveryId) };
}

/**
 * POSTs a signed body, with the endpoint's own headers (its API key, say) under Phean's, which
 * always win. Only a 2xx counts; redirects are not followed.
 */
export async function postSigned(
  url: string,
  secret: string,
  body: string,
  ids: { webhookId: string; deliveryId: string },
  deps: Pick<DispatchDeps, "fetch" | "resolve" | "allowPrivate">,
  extraHeaders: Record<string, string> = {},
): Promise<{ ok: boolean; status: number | null; error: string | null; latencyMs: number }> {
  const started = Date.now();
  try {
    await assertWebhookUrlSafe(url, { allowPrivate: deps.allowPrivate, resolve: deps.resolve });
    const response = await deps.fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        ...extraHeaders,
        "content-type": "application/json",
        "user-agent": "Phean-Webhooks/1",
        [SIGNATURE_HEADER]: signPayload(secret, body),
        "Phean-Webhook-Id": ids.webhookId,
        "Phean-Delivery-Id": ids.deliveryId,
      },
      body,
    });
    await response.body?.cancel().catch(() => undefined);
    const ok = response.status >= 200 && response.status < 300;
    return { ok, status: response.status, error: ok ? null : `HTTP ${response.status}`, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, status: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 300), latencyMs: Date.now() - started };
  }
}

async function sendOne(db: Db, hook: Claimed, deps: DispatchDeps): Promise<"delivered" | "failed" | "empty"> {
  const batch = await buildBatch(db, hook, deps);
  if (!batch) {
    await db.update(webhooks).set({ leaseUntil: null }).where(eq(webhooks.id, hook.id));
    return "empty";
  }
  const body = JSON.stringify(batch.payload);
  let secret: string;
  let headers: Record<string, string>;
  try {
    secret = decryptSecret(hook.secret_ciphertext);
    headers = hook.headers_ciphertext ? (JSON.parse(decryptSecret(hook.headers_ciphertext)) as Record<string, string>) : {};
  } catch {
    await disable(db, hook.id, "The signing secret or headers can no longer be read (the server key changed). Register the webhook again, with its headers.");
    return "failed";
  }
  const result = await postSigned(hook.url, secret, body, { webhookId: hook.id, deliveryId: batch.payload.deliveryId }, deps, headers);

  await db.transaction(async (tx) => {
    await tx
      .update(webhookDeliveries)
      .set({
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        lastError: result.error,
        ...(result.ok && { status: "delivered" as const, deliveredAt: new Date() }),
      })
      .where(inArray(webhookDeliveries.id, batch.deliveryIds));
    if (result.ok) {
      await tx
        .update(webhooks)
        .set({ consecutiveFailures: 0, lastSuccessAt: new Date(), lastStatus: result.status, lastError: null, leaseUntil: null, nextAttemptAt: new Date() })
        .where(eq(webhooks.id, hook.id));
      return;
    }
    const failures = hook.consecutive_failures + 1;
    await tx
      .update(webhooks)
      .set({
        consecutiveFailures: failures,
        lastFailureAt: new Date(),
        lastStatus: result.status,
        lastError: result.error,
        leaseUntil: null,
        nextAttemptAt: sql`now() + make_interval(secs => ${backoffSeconds(failures)})`,
      })
      .where(eq(webhooks.id, hook.id));
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      await disable(tx as unknown as Db, hook.id, `Disabled after ${failures} failed deliveries in a row. Last error: ${result.error}. Register the webhook again to resume.`);
    }
  });
  return result.ok ? "delivered" : "failed";
}

/** Switches a webhook off; what it would have received is dropped rather than replayed weeks later. */
async function disable(db: Db, webhookId: string, reason: string): Promise<void> {
  await db.update(webhooks).set({ status: "disabled", disabledReason: reason, leaseUntil: null }).where(eq(webhooks.id, webhookId));
  await db
    .update(webhookDeliveries)
    .set({ status: "dead" })
    .where(and(eq(webhookDeliveries.webhookId, webhookId), eq(webhookDeliveries.status, "pending")));
}

/**
 * Sends everything that is due, webhook by webhook, until nothing is left or the time budget runs
 * out. A webhook with more than one batch waiting is claimed again on the next round, so it keeps
 * its order without holding up the others.
 */
export async function dispatchDue(db: Db, deps: DispatchDeps = defaultDispatchDeps()): Promise<DispatchReport> {
  const report: DispatchReport = { batches: 0, delivered: 0, failed: 0 };
  const deadline = Date.now() + deps.budgetMs;
  await dropForInactiveAgents(db);
  while (Date.now() < deadline) {
    const claimed = await claimWebhooks(db, 10);
    if (claimed.length === 0) break;
    const results = await Promise.all(claimed.map((hook) => sendOne(db, hook, deps)));
    for (const result of results) {
      if (result === "empty") continue;
      report.batches += 1;
      if (result === "delivered") report.delivered += 1;
      else report.failed += 1;
    }
  }
  return report;
}

/** Drops delivered and dead deliveries past the retention window. */
export async function pruneDeliveries(db: Db): Promise<void> {
  await db
    .delete(webhookDeliveries)
    .where(
      and(
        inArray(webhookDeliveries.status, ["delivered", "dead"]),
        lt(webhookDeliveries.createdAt, sql`now() - make_interval(days => ${RETENTION_DAYS})`),
      ),
    );
}

export type { WebhookRow };
