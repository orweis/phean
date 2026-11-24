import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { NotificationTopic } from "@/lib/notification-preferences";

import { member, notificationPreferences, pushDeliveries, pushDevices, pushMutes, tasks } from "../db/schema";
import { inTenant, type Ctx } from "../domain/context";
import type { RoutedEvent } from "../webhooks/routing";

/** Events that put a request in front of people: a new question, or an answer taken back (it is open again). */
const ASKING_ACTIONS = new Set(["task.input_requested", "task.input_retracted"]);

/** Which of a person's preferences (`NOTIFICATION_TOPICS`) a push of this kind, queued by this event, falls under. */
export function pushTopicOf(kind: "request" | "resolved", action: string | undefined): NotificationTopic {
  if (kind === "resolved") return "resolved";
  return action === "task.input_retracted" ? "reopened" : "requests";
}

/** Whether a person (their preferences row, or none for the defaults) wants pushes on this topic. */
export function wantsTopic(preferences: Partial<Record<NotificationTopic, boolean>> | null | undefined, topic: NotificationTopic): boolean {
  return preferences?.[topic] ?? true;
}

/** The person who made this change, when a person did: no one is notified of their own doing. */
export const actingPerson = (ctx: Pick<Ctx, "actor">): string | null => (ctx.actor.type === "user" ? ctx.actor.id : null);

/** A device's preferences, read beside it. */
const preferenceColumns = {
  requests: notificationPreferences.requests,
  reopened: notificationPreferences.reopened,
  resolved: notificationPreferences.resolved,
};

const requestIdOf = (event: RoutedEvent) => (typeof event.data.requestId === "string" ? event.data.requestId : null);

/**
 * Writes the push outbox in the caller's transaction, beside the webhooks' (`enqueueDeliveries`):
 *
 * - A request asked (or reopened) queues a `request` push to every device of the workspace's
 *   members who have not muted it and want that topic (`requests`, or `reopened` for an answer
 *   taken back). Memberships only, so a platform admin's read-only access never notifies them.
 * - Any change to a task whose request devices were told about, and which is no longer open
 *   (answered, closed by its agent, replaced, or archived with the task), queues a `resolved` push
 *   that replaces the notification, to every device that was sent it whose person wants
 *   `resolved`. One not sent yet is simply dropped.
 *
 * No one is notified of their own doing: the acting person's devices get neither push. Their
 * `request` rows are written already dead (`own_action`), so the one device they acted from (a
 * notification's Undo, which shows the request itself) can be marked shown by
 * `undoFromNotification`, and a later answer elsewhere still replaces it.
 *
 * Returns how many pushes were queued, so the caller wakes the sender only when there are some.
 */
export async function enqueuePushes(ctx: Ctx, rows: readonly RoutedEvent[]): Promise<number> {
  const taskEvents = rows.filter((row) => row.entityType === "task");
  if (taskEvents.length === 0) return 0;
  const queued = await resolveClosedRequests(ctx, taskEvents);

  const asks = taskEvents.filter((row) => ASKING_ACTIONS.has(row.action) && requestIdOf(row));
  if (asks.length === 0) return queued;
  const recipients = await ctx.db
    .select({ deviceId: pushDevices.id, userId: pushDevices.userId, preferences: preferenceColumns })
    .from(pushDevices)
    .innerJoin(member, and(eq(member.userId, pushDevices.userId), eq(member.organizationId, ctx.tenant.id)))
    .leftJoin(pushMutes, and(eq(pushMutes.tenantId, ctx.tenant.id), eq(pushMutes.userId, pushDevices.userId)))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, pushDevices.userId))
    .where(isNull(pushMutes.userId));
  if (recipients.length === 0) return queued;
  const actor = actingPerson(ctx);
  const values = asks.flatMap((event) => {
    const topic = pushTopicOf("request", event.action);
    return recipients
      .filter((recipient) => recipient.userId === actor || wantsTopic(recipient.preferences, topic))
      .map(({ deviceId, userId }) => ({
        tenantId: ctx.tenant.id,
        deviceId,
        eventId: event.id,
        kind: "request" as const,
        taskId: event.entityId,
        requestId: requestIdOf(event)!,
        ...(userId === actor && { status: "dead" as const, lastError: "own_action" }),
      }));
  });
  if (values.length === 0) return queued;
  await ctx.db.insert(pushDeliveries).values(values).onConflictDoNothing();
  return queued + values.filter((value) => !value.status).length;
}

/** The request pushes of these tasks whose request is no longer the task's open one, closed once each. */
async function resolveClosedRequests(ctx: Ctx, taskEvents: readonly RoutedEvent[]): Promise<number> {
  const taskIds = [...new Set(taskEvents.map((event) => event.entityId))];
  const outstanding = await ctx.db
    .select({
      id: pushDeliveries.id,
      deviceId: pushDeliveries.deviceId,
      userId: pushDevices.userId,
      wantsResolved: sql<boolean>`coalesce(${notificationPreferences.resolved}, true)`,
      taskId: pushDeliveries.taskId,
      requestId: pushDeliveries.requestId,
      status: pushDeliveries.status,
      inFlight: sql<boolean>`coalesce(${pushDeliveries.leaseUntil} > now(), false)`,
    })
    .from(pushDeliveries)
    .innerJoin(tasks, and(eq(tasks.tenantId, pushDeliveries.tenantId), eq(tasks.id, pushDeliveries.taskId)))
    .innerJoin(pushDevices, eq(pushDevices.id, pushDeliveries.deviceId))
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, pushDevices.userId))
    .where(
      and(
        inTenant(ctx, pushDeliveries),
        inArray(pushDeliveries.taskId, taskIds),
        eq(pushDeliveries.kind, "request"),
        isNull(pushDeliveries.closedAt),
        sql`(${tasks.inputRequest}->>'id') is distinct from ${pushDeliveries.requestId}`,
      ),
    );
  if (outstanding.length === 0) return 0;

  // A push still waiting to go out is dropped; one already shown (or on its way) gets replaced.
  const unsent = outstanding.filter((row) => row.status === "pending" && !row.inFlight).map((row) => row.id);
  await ctx.db.update(pushDeliveries).set({ closedAt: new Date() }).where(inArray(pushDeliveries.id, outstanding.map((row) => row.id)));
  if (unsent.length) await ctx.db.update(pushDeliveries).set({ status: "dead", lastError: "closed" }).where(inArray(pushDeliveries.id, unsent));

  const closingEvent = new Map(taskEvents.map((event) => [event.entityId, event.id]));
  const actor = actingPerson(ctx);
  const shown = new Map<string, { deviceId: string; taskId: string; requestId: string }>();
  for (const row of outstanding) {
    if (row.status === "dead" || unsent.includes(row.id)) continue;
    // The person who closed it knows; one who turned these off keeps the notification as it is.
    if (row.userId === actor || !row.wantsResolved) continue;
    shown.set(`${row.deviceId}|${row.requestId}`, row);
  }
  if (shown.size === 0) return 0;
  const values = [...shown.values()].map((row) => ({
    tenantId: ctx.tenant.id,
    deviceId: row.deviceId,
    eventId: closingEvent.get(row.taskId)!,
    kind: "resolved" as const,
    taskId: row.taskId,
    requestId: row.requestId,
  }));
  await ctx.db.insert(pushDeliveries).values(values).onConflictDoNothing();
  return values.length;
}
