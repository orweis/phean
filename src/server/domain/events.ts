import { and, desc, eq, gte, or, sql } from "drizzle-orm";

import type { EventAction } from "@/lib/activity";

import { publicColumns } from "../db/columns";
import { events, type EventRow } from "../db/schema";
import type { Ctx } from "./context";
import { assertCan } from "./policy";
import { ActivityInput } from "./schemas";
import { service } from "./service";

export type { EventAction };
export type EntityType = "goal" | "task" | "memory" | "agent" | "member";

export interface EventInput {
  action: EventAction;
  entityType: EntityType;
  entityId: string;
  summary: string;
  data?: Record<string, unknown>;
}

export type Activity = Omit<EventRow, "tenantId">;

const activityColumns = publicColumns(events, ["tenantId"]);

export async function recordEvents(ctx: Ctx, inputs: readonly EventInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await ctx.db.insert(events).values(
    inputs.map((event) => ({
      tenantId: ctx.tenant.id,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      actorName: ctx.actor.name,
      ...event,
      data: event.data ?? {},
    })),
  );
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
        eq(events.tenantId, ctx.tenant.id),
        since ? gte(events.createdAt, new Date(since)) : undefined,
        goalId ? concernsGoal(goalId) : undefined,
      ),
    )
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(limit);
});
