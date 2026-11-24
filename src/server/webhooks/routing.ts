import { and, eq, inArray, or, sql } from "drizzle-orm";

import { WATCHED_ENTITY_TYPES, type WatchedEntityType, type WatchReason, type WebhookTopic } from "@/lib/domain";

import type { Db } from "../db/client";
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
  if (action.startsWith("pipeline.")) topics.push("pipelines");
  // A run and its stops are about the run's task (`taskId`), so its watchers hear them under tasks too.
  if (action.startsWith("pipeline.run_") || action.startsWith("pipeline.stop_")) topics.push("tasks");
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

/** What one listening agent (a webhook, or a realtime stream) asked to hear. */
export interface Listener {
  agentId: string;
  topics: readonly WebhookTopic[];
  scope: "related" | "all";
}

/** What an agent follows: `type|id` of each watched object, with why it follows it. */
export type Watching = ReadonlyMap<string, WatchReason>;

/**
 * A listener's sub-agents: their names by id, and what they handed off (`type|id` → the sub-agents
 * that follow it as a handoff). A parent hears how its sub-agents' handoffs go, and of tasks handed
 * to them by name, since a sub-agent (one sharing its parent's token, especially) rarely listens itself.
 */
export interface Family {
  names: ReadonlyMap<string, string>;
  handoffs: ReadonlyMap<string, readonly string[]>;
}

const NO_FAMILY: Family = { names: new Map(), handoffs: new Map() };

/** A sub-agent an event reached its parent for. */
export interface ForAgent {
  id: string;
  name: string;
}

/** Why a listener hears an event, and which of its sub-agents the handoff reasons were for (empty when they were all its own). */
export interface Routed {
  reasons: string[];
  forAgents: ForAgent[];
}

/**
 * Why `listener` hears `event`, or nothing when it does not: an answer to its own question, an
 * object it watches (`watching`), or, with scope "all", any event in its topics. Handoffs reach
 * an agent whatever its topics: a task handed to it (`handed_to_you`), and every change to a task
 * it handed off (`handed_off_by_you`), since it passed that work on and must hear how it ends. Both
 * also reach it for its sub-agents (`family`), naming them in `forAgents`. An agent never hears
 * about its own actions, and hears nothing for a sub-agent about what that sub-agent did itself.
 */
export function routeEvent(event: RoutedEvent, listener: Listener, watching: Watching, actorAgentId: string | null, family: Family = NO_FAMILY): Routed {
  if (listener.agentId === actorAgentId) return { reasons: [], forAgents: [] };
  const inTopics = topicsOf(event.action).some((topic) => listener.topics.includes(topic));
  const reasons = new Set<string>();
  const forAgents = new Set<string>();
  /** A family member's handoff reason, unless that member is the one acting. */
  const forSubagent = (agentId: string, reason: string) => {
    if (agentId === actorAgentId || !family.names.has(agentId)) return;
    reasons.add(reason);
    forAgents.add(agentId);
  };
  if (inTopics && ANSWER_ACTIONS.has(event.action) && event.data.agentId === listener.agentId) reasons.add("asked_by_you");
  if (event.action === HANDOFF_ACTION) {
    if (event.data.toAgentId === listener.agentId) reasons.add("handed_to_you");
    else if (typeof event.data.toAgentId === "string") forSubagent(event.data.toAgentId, "handed_to_you");
  }
  for (const key of concerns(event)) {
    const id = `${key.type}|${key.id}`;
    for (const subagent of family.handoffs.get(id) ?? []) forSubagent(subagent, "handed_off_by_you");
    const followed = watching.get(id);
    if (!followed) continue;
    if (followed === "handoff") reasons.add("handed_off_by_you");
    if (inTopics) reasons.add(key.reason);
  }
  if (inTopics && reasons.size === 0 && listener.scope === "all") reasons.add("workspace");
  return { reasons: [...reasons], forAgents: [...forAgents].sort().map((id) => ({ id, name: family.names.get(id)! })) };
}

/** Just the reasons `routeEvent` gives. */
export function reasonsFor(event: RoutedEvent, listener: Listener, watching: Watching, actorAgentId: string | null, family?: Family): string[] {
  return routeEvent(event, listener, watching, actorAgentId, family).reasons;
}

/** Indexes watch rows (`type`, `id`, `reason`) as `reasonsFor` reads them. */
export function watchingOf(rows: readonly { type: string; id: string; reason: WatchReason }[]): Map<string, WatchReason> {
  return new Map(rows.map((row) => [`${row.type}|${row.id}`, row.reason]));
}

/** What each listening agent follows among the objects `events` concern, with its family's handoffs. */
export interface Follows {
  watching: Watching;
  family: Family;
}

/**
 * Reads, for each of `agentIds` in one workspace, its watches on the objects `rows` concern, and
 * its sub-agents with their handoff follows on them: what `routeEvent` needs to route `rows`.
 */
export async function loadFollows(db: Db, tenantId: string, agentIds: readonly string[], rows: readonly RoutedEvent[]): Promise<Map<string, Follows>> {
  const follows = new Map<string, Follows>();
  if (agentIds.length === 0) return follows;
  const subagents = await db
    .select({ id: agents.id, name: agents.name, parentAgentId: agents.parentAgentId })
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), inArray(agents.parentAgentId, [...agentIds])));
  const keys = rows.flatMap(concerns);
  const watched = keys.length
    ? await db
        .select({ agentId: watches.agentId, type: watches.entityType, id: watches.entityId, reason: watches.reason })
        .from(watches)
        .where(
          and(
            eq(watches.tenantId, tenantId),
            inArray(watches.agentId, [...agentIds, ...subagents.map((agent) => agent.id)]),
            or(...keys.map((key) => sql`(${watches.entityType} = ${key.type} and ${watches.entityId} = ${key.id})`)),
          ),
        )
    : [];
  for (const agentId of agentIds) {
    const mine = subagents.filter((agent) => agent.parentAgentId === agentId);
    const handoffs = new Map<string, string[]>();
    for (const row of watched) {
      if (row.reason !== "handoff" || !mine.some((agent) => agent.id === row.agentId)) continue;
      const key = `${row.type}|${row.id}`;
      handoffs.set(key, [...(handoffs.get(key) ?? []), row.agentId]);
    }
    follows.set(agentId, {
      watching: watchingOf(watched.filter((row) => row.agentId === agentId)),
      family: { names: new Map(mine.map((agent) => [agent.id, agent.name])), handoffs },
    });
  }
  return follows;
}

/**
 * Writes the outbox: one delivery per (active webhook, event) for every live agent the event
 * concerns (an agent whose access lapsed hears nothing until it is renewed), in the caller's
 * transaction. Returns how many were queued, so the caller knows to wake the dispatcher once the
 * transaction commits.
 */
export async function enqueueDeliveries(ctx: Ctx, rows: readonly RoutedEvent[]): Promise<number> {
  const routable = rows.filter((row) => topicsOf(row.action).length > 0);
  if (routable.length === 0) return 0;

  const hooks = await ctx.db
    .select({ id: webhooks.id, agentId: webhooks.agentId, topics: webhooks.topics, scope: webhooks.scope })
    .from(webhooks)
    .innerJoin(agents, and(eq(agents.tenantId, webhooks.tenantId), eq(agents.id, webhooks.agentId)))
    .where(and(eq(webhooks.tenantId, ctx.tenant.id), eq(webhooks.status, "active"), liveAgent()));
  if (hooks.length === 0) return 0;

  const follows = await loadFollows(ctx.db, ctx.tenant.id, hooks.map((hook) => hook.agentId), routable);
  const actorAgent = ctx.actor.type === "agent" ? ctx.actor.id : null;

  const deliveries = routable.flatMap((event) =>
    hooks.flatMap((hook) => {
      const follow = follows.get(hook.agentId);
      const { reasons, forAgents } = routeEvent(event, hook, follow?.watching ?? new Map(), actorAgent, follow?.family);
      return reasons.length ? [{ tenantId: ctx.tenant.id, webhookId: hook.id, eventId: event.id, reasons, forAgents: forAgents.length ? forAgents : null }] : [];
    }),
  );
  if (deliveries.length === 0) return 0;
  await ctx.db.insert(webhookDeliveries).values(deliveries).onConflictDoNothing();
  return deliveries.length;
}
