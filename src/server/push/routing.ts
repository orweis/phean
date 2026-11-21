import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { member, pushDeliveries, pushDevices, pushMutes, tasks } from "../db/schema";
import { inTenant, type Ctx } from "../domain/context";
import type { RoutedEvent } from "../webhooks/routing";

/** Events that put a request in front of people: a new question, or an answer taken back (it is open again). */
const ASKING_ACTIONS = new Set(["task.input_requested", "task.input_retracted"]);

const requestIdOf = (event: RoutedEvent) => (typeof event.data.requestId === "string" ? event.data.requestId : null);

/**
 * Writes the push outbox in the caller's transaction, beside the webhooks' (`enqueueDeliveries`):
 *
 * - A request asked (or reopened) queues a `request` push to every device of the workspace's
 *   members who have not muted it, except the person acting. Memberships only, so a platform
 *   admin's read-only access never notifies them.
 * - Any change to a task whose request devices were told about, and which is no longer open
 *   (answered, closed by its agent, replaced, or archived with the task), queues a `resolved` push
 *   that replaces the notification, to every device that was sent it except the acting person's,
 *   who closed it themselves. One not sent yet is simply dropped.
 *
 * Returns how many pushes were queued, so the caller wakes the sender only when there are some.
 */
export async function enqueuePushes(ctx: Ctx, rows: readonly RoutedEvent[]): Promise<number> {
  const taskEvents = rows.filter((row) => row.entityType === "task");
  if (taskEvents.length === 0) return 0;
  const actorUserId = ctx.actor.type === "user" ? ctx.actor.id : null;
  let queued = await resolveClosedRequests(ctx, taskEvents, actorUserId);

  const asks = taskEvents.filter((row) => ASKING_ACTIONS.has(row.action) && requestIdOf(row));
  if (asks.length === 0) return queued;
  const recipients = await ctx.db
    .select({ deviceId: pushDevices.id })
    .from(pushDevices)
    .innerJoin(member, and(eq(member.userId, pushDevices.userId), eq(member.organizationId, ctx.tenant.id)))
    .leftJoin(pushMutes, and(eq(pushMutes.tenantId, ctx.tenant.id), eq(pushMutes.userId, pushDevices.userId)))
    .where(and(isNull(pushMutes.userId), actorUserId ? ne(pushDevices.userId, actorUserId) : undefined));
  if (recipients.length === 0) return queued;
  const values = asks.flatMap((event) =>
    recipients.map(({ deviceId }) => ({
      tenantId: ctx.tenant.id,
      deviceId,
      eventId: event.id,
      kind: "request" as const,
      taskId: event.entityId,
      requestId: requestIdOf(event)!,
    })),
  );
  await ctx.db.insert(pushDeliveries).values(values).onConflictDoNothing();
  queued += values.length;
  return queued;
}

/** The request pushes of these tasks whose request is no longer the task's open one, closed once each. */
async function resolveClosedRequests(ctx: Ctx, taskEvents: readonly RoutedEvent[], actorUserId: string | null): Promise<number> {
  const taskIds = [...new Set(taskEvents.map((event) => event.entityId))];
  const outstanding = await ctx.db
    .select({
      id: pushDeliveries.id,
      deviceId: pushDeliveries.deviceId,
      taskId: pushDeliveries.taskId,
      requestId: pushDeliveries.requestId,
      status: pushDeliveries.status,
      inFlight: sql<boolean>`coalesce(${pushDeliveries.leaseUntil} > now(), false)`,
      userId: pushDevices.userId,
    })
    .from(pushDeliveries)
    .innerJoin(pushDevices, eq(pushDevices.id, pushDeliveries.deviceId))
    .innerJoin(tasks, and(eq(tasks.tenantId, pushDeliveries.tenantId), eq(tasks.id, pushDeliveries.taskId)))
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
  const shown = new Map<string, { deviceId: string; taskId: string; requestId: string }>();
  for (const row of outstanding) {
    if (row.status === "dead" || unsent.includes(row.id) || row.userId === actorUserId) continue;
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
