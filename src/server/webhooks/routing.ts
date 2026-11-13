import { and, eq, inArray, or, sql } from "drizzle-orm";

import { WATCHED_ENTITY_TYPES, type WatchedEntityType, type WebhookTopic } from "@/lib/domain";

import { agents, watches, webhookDeliveries, webhooks } from "../db/schema";
import { liveAgent } from "../domain/agent-liveness";
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

/** A task being handed to an agent by name, delivered to it whatever it watches. */
const HANDOFF_ACTION = "task.handed_off";

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
 * Writes the outbox: one delivery per (active webhook, event) for every live agent the event concerns
 * (an agent whose access lapsed hears nothing until it is renewed), in the caller's transaction. Returns how many were queued, so the caller knows to wake the
 * dispatcher once the transaction commits.
 */
/** What one listening agent (a webhook, or a realtime stream) asked to hear. */
export interface Listener {
  agentId: string;
  topics: readonly WebhookTopic[];
  scope: "related" | "all";
}

/**
 * Why `listener` hears `event`, or nothing when it does not: an answer to its own question, an
 * object it watches (`watching` holds `type|id` keys of its watches), or, with scope "all", any
 * event in its topics. An agent never hears about its own actions.
 */
export function reasonsFor(event: RoutedEvent, listener: Listener, watching: ReadonlySet<string>, actorAgentId: string | null): string[] {
  if (listener.agentId === actorAgentId) return [];
  const topics = topicsOf(event.action);
  if (!topics.some((topic) => listener.topics.includes(topic))) return [];
  const reasons = new Set<string>();
  if (ANSWER_ACTIONS.has(event.action) && event.data.agentId === listener.agentId) reasons.add("asked_by_you");
  if (event.action === HANDOFF_ACTION && event.data.toAgentId === listener.agentId) reasons.add("handed_to_you");
  for (const key of concerns(event)) if (watching.has(`${key.type}|${key.id}`)) reasons.add(key.reason);
  if (reasons.size === 0 && listener.scope === "all") reasons.add("workspace");
  return [...reasons];
}

export async function enqueueDeliveries(ctx: Ctx, rows: readonly RoutedEvent[]): Promise<number> {
  const routable = rows.filter((row) => topicsOf(row.action).length > 0);
  if (routable.length === 0) return 0;

  const hooks = await ctx.db
    .select({ id: webhooks.id, agentId: webhooks.agentId, topics: webhooks.topics, scope: webhooks.scope })
    .from(webhooks)
    .innerJoin(agents, and(eq(agents.tenantId, webhooks.tenantId), eq(agents.id, webhooks.agentId)))
    .where(and(eq(webhooks.tenantId, ctx.tenant.id), eq(webhooks.status, "active"), liveAgent()));
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
  const watchingByAgent = new Map<string, Set<string>>();
  for (const row of watched) {
    const keys = watchingByAgent.get(row.agentId) ?? new Set<string>();
    keys.add(`${row.type}|${row.id}`);
    watchingByAgent.set(row.agentId, keys);
  }
  const actorAgent = ctx.actor.type === "agent" ? ctx.actor.id : null;

  const deliveries = routable.flatMap((event) =>
    hooks.flatMap((hook) => {
      const reasons = reasonsFor(event, hook, watchingByAgent.get(hook.agentId) ?? new Set(), actorAgent);
      return reasons.length ? [{ tenantId: ctx.tenant.id, webhookId: hook.id, eventId: event.id, reasons }] : [];
    }),
  );
  if (deliveries.length === 0) return 0;
  await ctx.db.insert(webhookDeliveries).values(deliveries).onConflictDoNothing();
  return deliveries.length;
}
