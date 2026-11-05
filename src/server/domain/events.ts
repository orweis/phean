import { and, desc, eq, gte, or, sql } from "drizzle-orm";

import type { EventAction } from "@/lib/activity";

import { publicColumns } from "../db/columns";
import { events, type EventRow } from "../db/schema";
import { enqueueDeliveries, trackActorWatches } from "../webhooks/routing";
import { scheduleDispatch } from "../webhooks/trigger";
import { inTenant, onCommit, type Ctx } from "./context";
import { assertCan } from "./policy";
import { ActivityInput } from "./schemas";
import { service } from "./service";

export type { EventAction };
export type EntityType = "goal" | "task" | "memory" | "document" | "agent" | "member" | "workspace";

export interface EventInput {
  action: EventAction;
  entityType: EntityType;
  entityId: string;
  summary: string;
  data?: Record<string, unknown>;
}

export type Activity = Omit<EventRow, "tenantId">;

const activityColumns = publicColumns(events, ["tenantId"]);

/**
 * Appends to the activity log, which is also the source of every webhook. In the same transaction
 * as the change, it records what the acting agent now follows and queues a delivery for every
 * other agent the change concerns; once the transaction commits, the dispatcher is woken.
 */
export async function recordEvents(ctx: Ctx, inputs: readonly EventInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const rows = await ctx.db
    .insert(events)
    .values(
      inputs.map((event) => ({
        tenantId: ctx.tenant.id,
        actorType: ctx.actor.type,
        actorId: ctx.actor.id,
        actorName: ctx.actor.name,
        ...event,
        data: event.data ?? {},
      })),
    )
    .returning({ id: events.id, action: events.action, entityType: events.entityType, entityId: events.entityId, data: events.data });
  await trackActorWatches(ctx, rows);
  if (await enqueueDeliveries(ctx, rows)) onCommit(ctx, scheduleDispatch);
}

export const recordEvent = (ctx: Ctx, input: EventInput) => recordEvents(ctx, [input]);

/** Events about a goal itself, or about tasks and memories filed under it. */
const concernsGoal = (goalId: string) =>
  or(and(eq(events.entityType, "goal"), eq(events.entityId, goalId)), sql`${events.data}->>'goalId' = ${goalId}`);

export const listActivity = service(ActivityInput, async (ctx, { since, goalId, limit }): Promise<Activity[]> => {
  assertCan(ctx, "workspace:read");
  return ctx.db
    .select(activityColumns)
    .from(events)
    .where(
      and(
        inTenant(ctx, events),
        since ? gte(events.createdAt, new Date(since)) : undefined,
        goalId ? concernsGoal(goalId) : undefined,
      ),
    )
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(limit);
});

/** The latest events about one task, newest first. */
export async function taskActivity(ctx: Ctx, taskId: string, limit = 20): Promise<Activity[]> {
  return ctx.db
    .select(activityColumns)
    .from(events)
    .where(and(inTenant(ctx, events), eq(events.entityType, "task"), eq(events.entityId, taskId)))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(limit);
}
