import type { EventName } from "@/lib/analytics";
import { PIPELINE_TEMPLATE_META, PIPELINE_TEMPLATES } from "@/lib/pipeline-templates";
import { normalizeDefinition, targetsOf, type PipelineDefinition } from "@/lib/pipelines";

import { sendServerEvents, serverAnalyticsActive, type ServerEvent } from "../analytics";
import { onCommit, type Ctx } from "./context";

/**
 * Server-side analytics for the services (docs/ANALYTICS.md, "Server only"): what agents do over MCP,
 * sent through the Measurement Protocol once the change commits. Params are enums, booleans and
 * buckets only; where is the hashed workspace `sendServerEvents` adds. No person is named.
 */

/** One event as a service names it; the person and workspace come from its `Ctx`. */
export type DomainEvent = { [N in EventName]: Omit<ServerEvent<N>, "userId" | "tenantId"> }[EventName];

/**
 * Sends `events` once the work done through `ctx` commits (never if it rolls back), in the
 * background. Does nothing where analytics is off, and never throws.
 */
export async function trackAfterCommit(ctx: Ctx, ...events: DomainEvent[]): Promise<void> {
  if (events.length === 0 || !serverAnalyticsActive()) return;
  // Server events name no person (`serverEventBody`), so no lookup can fail the service here.
  const userId = ctx.actor.type === "user" ? ctx.actor.id : null;
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
