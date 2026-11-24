import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { EventName } from "@/lib/analytics";
import { PIPELINE_TEMPLATE_META, PIPELINE_TEMPLATES } from "@/lib/pipeline-templates";
import { normalizeDefinition, targetsOf, type PipelineDefinition } from "@/lib/pipelines";

import { sendServerEvents, serverAnalyticsActive, type ServerEvent } from "../analytics";
import { agents } from "../db/schema";
import { onCommit, tenantRow, type Ctx } from "./context";

/**
 * Server-side analytics for the services (docs/ANALYTICS.md, "Server only"): what agents do over MCP,
 * sent through the Measurement Protocol once the change commits. Params are enums, booleans and
 * buckets only; who and where are the hashed person and workspace `sendServerEvents` adds.
 */

/** One event as a service names it; the person and workspace come from its `Ctx`. */
export type DomainEvent = { [N in EventName]: Omit<ServerEvent<N>, "userId" | "tenantId"> }[EventName];

const parentAgent = alias(agents, "parent_agent");

/**
 * The person an event is about: the person acting, or the person who approved the acting agent (its
 * parent's approver, for a sub-agent). Phean's own pipelines agent stands for no one.
 */
export async function analyticsUserOf(ctx: Ctx): Promise<string | null> {
  const { actor } = ctx;
  if (actor.type === "user") return actor.id;
  if (actor.system) return null;
  const [row] = await ctx.db
    .select({ own: agents.createdByUserId, parent: parentAgent.createdByUserId })
    .from(agents)
    .leftJoin(parentAgent, and(eq(parentAgent.tenantId, agents.tenantId), eq(parentAgent.id, agents.parentAgentId)))
    .where(tenantRow(ctx, agents, actor.id));
  return row?.own ?? row?.parent ?? null;
}

/**
 * Sends `events` once the work done through `ctx` commits (never if it rolls back), in the
 * background. Does nothing, not even the lookup of who the agent works for, where analytics is off.
 */
export async function trackAfterCommit(ctx: Ctx, ...events: DomainEvent[]): Promise<void> {
  if (events.length === 0 || !serverAnalyticsActive()) return;
  const userId = await analyticsUserOf(ctx);
  const tenantId = ctx.tenant.id;
  onCommit(ctx, () => sendServerEvents(...events.map((event): ServerEvent => ({ ...event, userId, tenantId }) as ServerEvent)));
}

/** What `pipeline_create` says of a definition's shape. */
export function pipelineShape(definition: PipelineDefinition) {
  return {
    stops_count: definition.stops.length,
    has_person_stop: definition.stops.some((stop) => stop.kind === "person"),
    has_fork: definition.stops.some((stop) => Boolean(stop.then.fork)),
    has_choice: definition.stops.some((stop) => Boolean(stop.then.choice)),
  };
}

/** A definition's outline: its stops (ids, person or not, where each leads) and ends, without names or instructions. */
function outline(definition: PipelineDefinition): string {
  return JSON.stringify({
    start: definition.start,
    stops: definition.stops.map((stop) => [stop.id, stop.kind === "person", targetsOf(stop)]),
    ends: definition.ends.map((end) => end.id).sort(),
  });
}

const TEMPLATE_OUTLINES = PIPELINE_TEMPLATES.filter((key) => key !== "blank").map((key) => [key, outline(normalizeDefinition(PIPELINE_TEMPLATE_META[key].definition))] as const);

/**
 * The New pipeline panel's template a definition was made from, by its outline (the editor may name
 * other agents, people and words), or `blank` for anything else.
 */
export function templateOf(definition: PipelineDefinition): string {
  const own = outline(definition);
  return TEMPLATE_OUTLINES.find(([, shape]) => shape === own)?.[0] ?? "blank";
}
