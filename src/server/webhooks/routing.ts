import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { WATCHED_ENTITY_TYPES, type WatchedEntityType, type WebhookTopic } from "@/lib/domain";

import { agents, watches, webhookDeliveries, webhooks } from "../db/schema";
import type { Ctx } from "../domain/context";

/** The slice of an event that routing reads. */
export interface RoutedEvent {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
}

type WatchedType = WatchedEntityType;

/**
 * Human decisions an agent waits on: an answer to its question (or the answer taken back, which
 * reopens the question), and a goal approved or closed.
 */
const DECISION_ACTIONS = new Set(["task.input_answered", "task.input_retracted", "goal.approved", "goal.reactivated", "goal.achieved", "goal.abandoned"]);

/** Events about an agent's own question, delivered to it whatever it watches. */
const ANSWER_ACTIONS = new Set(["task.input_answered", "task.input_retracted"]);

/** Which topics an event belongs to; an agent gets it if its webhook subscribes to any of them. */
export function topicsOf(action: string): WebhookTopic[] {
  const topics: WebhookTopic[] = [];
  if (DECISION_ACTIONS.has(action)) topics.push("decisions");
  if (action.startsWith("task.")) topics.push("tasks");
  if (action.startsWith("goal.")) topics.push("goals");
  if (action.startsWith("memory.")) topics.push("memory");
  // Documents hang off tasks and goals, so they travel with those topics.
  if (action.startsWith("document.")) topics.push("tasks", "goals");
  return topics;
}

const isWatched = (type: string): type is WatchedType => (WATCHED_ENTITY_TYPES as readonly string[]).includes(type);
const idIn = (data: Record<string, unknown>, key: string) => (typeof data[key] === "string" ? (data[key] as string) : null);

/**
 * The objects an event concerns, each with the reason a watcher of it gets the event: the object
 * itself, the goal it is filed under (or its parent goal, for a sub-goal), and the task a memory
 * is about.
 */
export function concerns(event: RoutedEvent): { type: WatchedType; id: string; reason: string }[] {
  const keys: { type: WatchedType; id: string; reason: string }[] = [];
  if (isWatched(event.entityType)) keys.push({ type: event.entityType, id: event.entityId, reason: `watching:${event.entityType}` });
  const goalId = idIn(event.data, "goalId") ?? idIn(event.data, "parentGoalId");
  if (goalId && !(event.entityType === "goal" && event.entityId === goalId)) keys.push({ type: "goal", id: goalId, reason: "in_watched_goal" });
  const taskId = idIn(event.data, "taskId");
  if (taskId && event.entityType !== "task") keys.push({ type: "task", id: taskId, reason: "about_watched_task" });
  return keys;
}

/**
 * Phean follows what an agent works on: acting on a task, goal or memory makes the agent a watcher
 * of it. Forgetting a memory ends every watch on it.
 */
export async function trackActorWatches(ctx: Ctx, rows: readonly RoutedEvent[]): Promise<void> {
  const forgotten = rows.filter((row) => row.action === "memory.forgotten").map((row) => row.entityId);
  if (forgotten.length) {
    await ctx.db.delete(watches).where(and(eq(watches.tenantId, ctx.tenant.id), eq(watches.entityType, "memory"), inArray(watches.entityId, forgotten)));
  }
  if (ctx.actor.type !== "agent") return;
  const touched = rows.filter((row) => isWatched(row.entityType) && row.action !== "memory.forgotten");
  if (touched.length === 0) return;
  await ctx.db
    .insert(watches)
    .values(touched.map((row) => ({ tenantId: ctx.tenant.id, agentId: ctx.actor.id, entityType: row.entityType as WatchedType, entityId: row.entityId, reason: "auto" as const })))
    .onConflictDoNothing();
}

/**
 * Writes the outbox: one delivery per (active webhook, event) for every agent the event concerns,
 * in the caller's transaction. Returns how many were queued, so the caller knows to wake the
 * dispatcher once the transaction commits.
 */
export async function enqueueDeliveries(ctx: Ctx, rows: readonly RoutedEvent[]): Promise<number> {
  const routable = rows.filter((row) => topicsOf(row.action).length > 0);
  if (routable.length === 0) return 0;

  const hooks = await ctx.db
    .select({ id: webhooks.id, agentId: webhooks.agentId, topics: webhooks.topics, scope: webhooks.scope })
    .from(webhooks)
    .innerJoin(agents, and(eq(agents.tenantId, webhooks.tenantId), eq(agents.id, webhooks.agentId)))
    .where(and(eq(webhooks.tenantId, ctx.tenant.id), eq(webhooks.status, "active"), isNull(agents.revokedAt)));
  if (hooks.length === 0) return 0;

  const keys = routable.flatMap(concerns);
  const watched = keys.length
    ? await ctx.db
        .select({ agentId: watches.agentId, type: watches.entityType, id: watches.entityId })
        .from(watches)
        .where(
          and(
            eq(watches.tenantId, ctx.tenant.id),
            inArray(watches.agentId, hooks.map((hook) => hook.agentId)),
            or(...keys.map((key) => sql`(${watches.entityType} = ${key.type} and ${watches.entityId} = ${key.id})`)),
          ),
        )
    : [];
  const watching = new Set(watched.map((row) => `${row.agentId}|${row.type}|${row.id}`));
  const actorAgent = ctx.actor.type === "agent" ? ctx.actor.id : null;

  const deliveries = routable.flatMap((event) => {
    const topics = topicsOf(event.action);
    return hooks.flatMap((hook) => {
      // An agent never hears about its own actions.
      if (hook.agentId === actorAgent || !topics.some((topic) => hook.topics.includes(topic))) return [];
      const reasons = new Set<string>();
      if (ANSWER_ACTIONS.has(event.action) && event.data.agentId === hook.agentId) reasons.add("asked_by_you");
      for (const key of concerns(event)) if (watching.has(`${hook.agentId}|${key.type}|${key.id}`)) reasons.add(key.reason);
      if (reasons.size === 0 && hook.scope === "all") reasons.add("workspace");
      return reasons.size ? [{ tenantId: ctx.tenant.id, webhookId: hook.id, eventId: event.id, reasons: [...reasons] }] : [];
    });
  });
  if (deliveries.length === 0) return 0;
  await ctx.db.insert(webhookDeliveries).values(deliveries).onConflictDoNothing();
  return deliveries.length;
}
