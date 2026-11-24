import { randomUUID } from "node:crypto";

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { generateRequestDetails } from "web-push";

import { isOpenTaskStatus, toMemberRole } from "@/lib/domain";

import { vapidConfig, type VapidConfig } from "../config";
import type { Db } from "../db/client";
import { queryRows } from "../db/raw";
import { events, member, organization, pushDeliveries, pushDevices, pushMutes, tasks } from "../db/schema";
import { inTenant, personContext, tenantRow, type Ctx } from "../domain/context";
import { notificationPreferencesOf } from "../domain/notifications";
import { backoffSeconds, REQUEST_TIMEOUT_MS } from "../webhooks/dispatch";
import { decryptSecret } from "../webhooks/signing";
import { resolveHost, type Resolver } from "../webhooks/url-safety";
import { assertPushEndpointSafe } from "./endpoints";
import { requestPayload, resolvedPayload, resolvedReason, type PushPayload } from "./payload";
import { pushTopicOf, wantsTopic } from "./routing";

/** A push service keeps an undelivered notification this long; a decision a day old is better read in the app. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** Retries stop when a push is this old. */
export const PUSH_GIVE_UP_MS = 24 * 60 * 60 * 1000;
/** Sent and dead deliveries are kept this long, then pruned. */
export const PUSH_RETENTION_DAYS = 7;
/**
 * A sender holds a delivery this long; if it dies mid-send, another takes it after. It renews the
 * lease right before each send, and one send is cut off at `REQUEST_TIMEOUT_MS`, well inside it, so
 * a send never outlives the lease it started under.
 */
const LEASE_SECONDS = 60;
/** A device whose push service refuses this many sends in a row is deleted. */
export const PUSH_MAX_FAILURES = 10;
const BATCH = 25;

export interface PushMessage {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The JSON payload. Encrypted for the device (RFC 8291) and never logged. */
  payload: string;
  /** Replaces an undelivered push for the same request at the push service. */
  topic: string;
}

export interface PushResult {
  status: number | null;
  error: string | null;
}

/** Sends one message. Tests pass a fake push service; the real one is `webPushSender`. */
export type PushSender = (message: PushMessage) => Promise<PushResult>;

/**
 * Web Push through `web-push`: VAPID-signed (RFC 8292) and encrypted (RFC 8291, aes128gcm), with a
 * day's TTL, high urgency and the request id as Topic. Posting to a push service is the one call to
 * an outside URL that skips `postSigned`: the endpoint must be on a push service's host and resolve
 * to public addresses, checked again before every send. Redirects are not followed.
 */
export function webPushSender(vapid: VapidConfig, { fetch: send = globalThis.fetch, resolve = resolveHost }: { fetch?: typeof fetch; resolve?: Resolver } = {}): PushSender {
  return async (message) => {
    try {
      await assertPushEndpointSafe(message.endpoint, { resolve });
      const details = generateRequestDetails({ endpoint: message.endpoint, keys: message.keys }, message.payload, {
        vapidDetails: vapid,
        TTL: PUSH_TTL_SECONDS,
        urgency: "high",
        topic: message.topic,
        contentEncoding: "aes128gcm",
      });
      const response = await send(details.endpoint, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { ...Object.fromEntries(Object.entries(details.headers).map(([name, value]) => [name, String(value)])), "user-agent": "Phean-Push/1" },
        body: details.body ? new Uint8Array(details.body) : null,
      });
      await response.body?.cancel().catch(() => undefined);
      const ok = response.status >= 200 && response.status < 300;
      return { status: response.status, error: ok ? null : `HTTP ${response.status}` };
    } catch (error) {
      return { status: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
    }
  };
}

export interface PushDeps {
  /** Null when push is not configured (no VAPID keys): nothing is sent. */
  send: PushSender | null;
  /** Stop starting new batches after this long; the cron sweep picks up the rest. */
  budgetMs: number;
}

export const defaultPushDeps = (): PushDeps => {
  const vapid = vapidConfig();
  return { send: vapid ? webPushSender(vapid) : null, budgetMs: 25_000 };
};

export interface PushReport {
  sent: number;
  failed: number;
  dropped: number;
}

interface Claimed {
  id: number;
  tenant_id: string;
  device_id: string;
  event_id: number;
  kind: "request" | "resolved";
  task_id: string;
  request_id: string;
  attempts: number;
  created_at: Date | string;
  closed_at: Date | string | null;
  lease_token: string;
}

/**
 * Takes the lease on due deliveries. SKIP LOCKED lets kicks and the sweep run at once without
 * sending a row twice. A `resolved` push waits while its request's push is still in flight, so it
 * never arrives before the notification it replaces.
 */
async function claimDue(db: Db, limit: number): Promise<Claimed[]> {
  return queryRows<Claimed>(
    db,
    sql`
      UPDATE push_deliveries SET lease_until = now() + make_interval(secs => ${LEASE_SECONDS}), lease_token = ${randomUUID()}
      WHERE id IN (
        SELECT d.id FROM push_deliveries d
        WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND (d.lease_until IS NULL OR d.lease_until < now())
          AND NOT (d.kind = 'resolved' AND EXISTS (
            SELECT 1 FROM push_deliveries r
            WHERE r.device_id = d.device_id AND r.request_id = d.request_id AND r.kind = 'request' AND r.status = 'pending' AND r.lease_until > now()))
        ORDER BY d.id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, tenant_id, device_id, event_id, kind, task_id, request_id, attempts, created_at, closed_at, lease_token`,
  );
}

/** The row, while this sender still holds its lease: one that took it over writes its own outcome. */
const held = (row: Claimed) => and(eq(pushDeliveries.id, row.id), eq(pushDeliveries.leaseToken, row.lease_token));

const drop = (db: Db, row: Claimed, reason: string) =>
  db.update(pushDeliveries).set({ status: "dead", lastError: reason, leaseUntil: null, leaseToken: null }).where(held(row));

/** Renews the lease just before sending; false when another sender took the row over in the meantime. */
async function renewLease(db: Db, row: Claimed): Promise<boolean> {
  const renewed = await db
    .update(pushDeliveries)
    .set({ leaseUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})` })
    .where(and(held(row), eq(pushDeliveries.status, "pending")))
    .returning({ id: pushDeliveries.id });
  return renewed.length > 0;
}

/** The payload for one delivery, read now and in the tenant, or the reason there is none to send. */
async function payloadFor(db: Db, row: Claimed, device: { userId: string; answerFromNotification: boolean; private: boolean }): Promise<PushPayload | string> {
  // Notifications are a member's: someone who left (or a platform admin) gets nothing.
  const [membership] = await db
    .select({ role: member.role, slug: organization.slug, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.organizationId, row.tenant_id), eq(member.userId, device.userId)));
  if (!membership) return "not_member";
  const tenant = { id: row.tenant_id, slug: membership.slug, name: membership.name };
  // Read as the recipient, inside the tenant, so a push shows only what they could open.
  const ctx: Ctx = { db, tenant, actor: { type: "user", id: device.userId, name: "", role: toMemberRole(membership.role) } };

  // Checked again now: no one hears of their own doing, nor of what they turned off since.
  const [event] = await ctx.db
    .select({ action: events.action, by: events.actorName, actorType: events.actorType, actorId: events.actorId })
    .from(events)
    .where(and(inTenant(ctx, events), eq(events.id, row.event_id)));
  if (event?.actorType === "user" && event.actorId === device.userId) return "own_action";
  if (!wantsTopic(await notificationPreferencesOf(personContext(db, { id: device.userId, name: "" })), pushTopicOf(row.kind, event?.action))) return "preference";

  if (row.kind === "resolved") {
    return resolvedPayload(tenant.slug, row.request_id, { reason: resolvedReason(event?.action), by: event?.by ?? null }, device);
  }
  if (row.closed_at) return "closed";
  const [muted] = await db.select({ userId: pushMutes.userId }).from(pushMutes).where(and(eq(pushMutes.tenantId, row.tenant_id), eq(pushMutes.userId, device.userId)));
  if (muted) return "muted";
  const [task] = await ctx.db.select({ status: tasks.status, request: tasks.inputRequest }).from(tasks).where(tenantRow(ctx, tasks, row.task_id));
  if (!task?.request || task.request.id !== row.request_id || !isOpenTaskStatus(task.status)) return "closed";
  return requestPayload(tenant, row.task_id, task.request, device);
}

/** What became of one claimed row; `lost` when another sender took it over, which reports it instead. */
type Outcome = "sent" | "failed" | "dropped" | "lost";

async function sendOne(db: Db, row: Claimed, send: PushSender): Promise<Outcome> {
  const [device] = await db
    .select({
      id: pushDevices.id,
      userId: pushDevices.userId,
      endpoint: pushDevices.endpoint,
      p256dh: pushDevices.p256dhCiphertext,
      auth: pushDevices.authCiphertext,
      answerFromNotification: pushDevices.answerFromNotification,
      private: pushDevices.private,
    })
    .from(pushDevices)
    .where(eq(pushDevices.id, row.device_id));
  if (!device) return "dropped";
  const payload = await payloadFor(db, row, device);
  if (typeof payload === "string") {
    await drop(db, row, payload);
    return "dropped";
  }
  let keys: PushMessage["keys"];
  try {
    keys = { p256dh: decryptSecret(device.p256dh), auth: decryptSecret(device.auth) };
  } catch {
    // The server key changed: this subscription can never be written to again.
    await db.delete(pushDevices).where(eq(pushDevices.id, device.id));
    return "dropped";
  }

  // The rows before this one may have taken a while: if its lease ran out and another sender took
  // it, that sender sends it, not this one.
  if (!(await renewLease(db, row))) return "lost";
  const result = await send({ endpoint: device.endpoint, keys, payload: JSON.stringify(payload), topic: row.request_id });
  const ok = result.status !== null && result.status >= 200 && result.status < 300;
  if (ok) {
    await db
      .update(pushDeliveries)
      .set({ status: "sent", sentAt: new Date(), attempts: row.attempts + 1, lastError: null, leaseUntil: null, leaseToken: null })
      .where(held(row));
    await db.update(pushDevices).set({ failures: 0, lastSuccessAt: new Date() }).where(eq(pushDevices.id, device.id));
    return "sent";
  }
  // The subscription is gone (unsubscribed, expired, the app uninstalled), or the push service
  // refuses this server's pushes for it: so is the device. 429 and 5xx are retried.
  if (result.status !== null && GONE.has(result.status)) {
    await db.delete(pushDevices).where(eq(pushDevices.id, device.id));
    return "dropped";
  }
  const attempts = row.attempts + 1;
  const retryAt = Date.now() + backoffSeconds(attempts) * 1000;
  const givesUp = retryAt - new Date(row.created_at).getTime() > PUSH_GIVE_UP_MS;
  await db
    .update(pushDeliveries)
    .set({
      attempts,
      lastError: result.error,
      leaseUntil: null,
      leaseToken: null,
      ...(givesUp ? { status: "dead" as const } : { nextAttemptAt: new Date(retryAt) }),
    })
    .where(held(row));
  const [counted] = await db
    .update(pushDevices)
    .set({ failures: sql`${pushDevices.failures} + 1` })
    .where(eq(pushDevices.id, device.id))
    .returning({ failures: pushDevices.failures });
  // A device that has not taken a push in this many tries is not coming back.
  if (counted && counted.failures >= PUSH_MAX_FAILURES) await db.delete(pushDevices).where(eq(pushDevices.id, device.id));
  return "failed";
}

/** Push service answers that end a subscription: gone (404, 410), or refused for this server's key (401, 403). */
const GONE = new Set([401, 403, 404, 410]);

/**
 * Sends every push that is due until none is left or the time budget runs out. Without VAPID keys
 * nothing is sent; what is queued then expires after a day like any push that cannot get through.
 */
export async function sendDuePushes(db: Db, deps: PushDeps = defaultPushDeps()): Promise<PushReport> {
  const report: PushReport = { sent: 0, failed: 0, dropped: 0 };
  await db
    .update(pushDeliveries)
    .set({ status: "dead", lastError: "expired", leaseToken: null })

    .where(and(eq(pushDeliveries.status, "pending"), lt(pushDeliveries.createdAt, new Date(Date.now() - PUSH_GIVE_UP_MS))));
  if (!deps.send) return report;
  const deadline = Date.now() + deps.budgetMs;
  while (Date.now() < deadline) {
    const claimed = await claimDue(db, BATCH);
    if (claimed.length === 0) break;
    // One device at a time, in the order they were queued (RETURNING keeps none): a device's
    // request push goes out before the resolved push that replaces it, and that before a reopening.
    const byDevice = new Map<string, Claimed[]>();
    for (const row of claimed.sort((a, b) => Number(a.id) - Number(b.id))) byDevice.set(row.device_id, [...(byDevice.get(row.device_id) ?? []), row]);

    await Promise.all(
      [...byDevice.values()].map(async (rows) => {
        for (const row of rows) {
          const outcome = await sendOne(db, row, deps.send!);
          if (outcome !== "lost") report[outcome] += 1;
        }
      }),
    );
  }
  return report;
}

/** Drops sent and dead deliveries past the retention window. */
export async function prunePushDeliveries(db: Db): Promise<void> {
  await db
    .delete(pushDeliveries)
    .where(and(inArray(pushDeliveries.status, ["sent", "dead"]), lt(pushDeliveries.createdAt, sql`now() - make_interval(days => ${PUSH_RETENTION_DAYS})`)));
}
