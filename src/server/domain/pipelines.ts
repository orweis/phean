import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lte, max, ne, sql } from "drizzle-orm";
import type { z } from "zod";

import { LIVE_RUN_STATUSES, type PipelineKind, type RunStatus, type Source } from "@/lib/domain";
import { stopViewState } from "@/lib/pipeline-map";
import { nextFiring, nextStepFor, stopPosition, type RunRecord } from "@/lib/pipeline-stats";
import { HANDOFF_RETRY_FIRST_MINUTES, isStuckHandoff } from "@/lib/pipeline-handoffs";
import { clipRunName, normalizeDefinition, runTitle, stopOrder, type PipelineDefinition } from "@/lib/pipelines";
import { routes } from "@/lib/routes";

import { newId } from "../db/ids";
import { agents, pipelineRuns, pipelineRunStops, pipelines, pipelineTriggers, pipelineVersions, tasks, type PipelineVersionRow } from "../db/schema";
import { pipelineShape, templateOf, trackAfterCommit } from "./analytics";
import { createdByFields, inTenant, inTransaction, tenantRow, type Ctx } from "./context";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { recordEvent, runActivity, type Activity } from "./events";
import {
  actorProblems,
  beginRun,
  endRun,
  EVENT_INPUTS,
  findPipeline,
  findRun,
  loadDefinition,
  pipelineContext,
  pipelineColumns,
  rerunRun,
  resendStopHandoff,
  runColumns,
  runView,
  servedByOf,
  setPipelineStatus,
  stopAgents,
  sweepDeadlines,
  type HandoffResend,
  type Pipeline,
  type PipelineRun,
  type RunStart,
  type RunView,
} from "./pipeline-engine";
import { assertCan, can } from "./policy";
import {
  CancelRunInput,
  DefinePipelineInput,
  ListPipelinesInput,
  ListStuckStopsInput,
  ListRunsInput,
  PipelineHistoryInput,
  PipelineRefInput,
  PipelineRequestsInput,
  PipelineTriggersInput,
  PipelineVersionInput,
  PipelineVersionRefInput,
  RerunFromInput,
  ResendHandoffInput,
  RunOptionsInput,
  RunRefInput,
  StartRunInput,
  TaskRefInput,
  UpdatePipelineInput,
  UpdateRunInput,
} from "./schemas";
import { service } from "./service";
import { updateTask } from "./tasks";

/**
 * Pipelines: defining them, changing them (a new version, or an agent's proposal on a regular
 * pipeline that a person approves), their triggers, and their runs. The engine that moves runs on
 * is `pipeline-engine.ts`; these are the services adapters call.
 *
 * Who may do what (`pipeline:write`, `pipeline:manage` in `lib/permissions.ts`): members and Write
 * agents define pipelines, start, cancel and rerun runs, and change ad hoc pipelines. A regular
 * pipeline is changed (and paused, resumed, archived) by its owner or a workspace owner or admin; an
 * agent's change to one is a proposal one of them approves.
 */

export type { HandoffResend, Pipeline, PipelineRun, RunStopView, RunView, StopHandoff } from "./pipeline-engine";
export type PipelineVersion = Omit<PipelineVersionRow, "tenantId">;
type TriggersInput = z.output<typeof PipelineTriggersInput>;

/** A pipeline's triggers as people and agents read them; the webhook's secret is never shown again. */
export interface PipelineTriggers {
  schedule: { cron: string; timeZone: string; lastFiredAt: Date | null } | null;
  events: { tag: string | null; source: Source | null }[];
  /** On when runs may be started by POST to `url` (a path on this deployment) with the secret. */
  webhook: { url: string } | null;
}

/** A pipeline in a list: its row with its runs at a glance. */
export type PipelineSummary = Pipeline & {
  runs: { total: number; live: number; waiting: number };
  lastRun: { id: string; number: number; status: RunStatus; startedAt: Date } | null;
};

export interface PipelineDetail {
  pipeline: Pipeline;
  /** The current version's definition: what new runs ride. */
  definition: PipelineDefinition;
  /** Every version, newest first, without its definition. */
  versions: Omit<PipelineVersion, "definition">[];
  /** Agents' proposed changes waiting on a person, with their definitions. */
  proposals: PipelineVersion[];
  triggers: PipelineTriggers;
  recentRuns: PipelineRun[];
}

/** What defining or changing a pipeline returns. `webhookSecret` is there only when the webhook was just turned on: shown once. */
export interface PipelineChange {
  pipeline: Pipeline;
  definition: PipelineDefinition;
  triggers: PipelineTriggers;
  /** A proposal waiting on a person, when an agent changed a regular pipeline. */
  proposal?: PipelineVersion;
  webhookSecret?: string;
  run?: PipelineRun;
}

const versionColumns = {
  pipelineId: pipelineVersions.pipelineId,
  number: pipelineVersions.number,
  definition: pipelineVersions.definition,
  createdByType: pipelineVersions.createdByType,
  createdById: pipelineVersions.createdById,
  createdByName: pipelineVersions.createdByName,
  reason: pipelineVersions.reason,
  proposalState: pipelineVersions.proposalState,
  baseVersion: pipelineVersions.baseVersion,
  settings: pipelineVersions.settings,
  decidedByUserId: pipelineVersions.decidedByUserId,
  decidedByName: pipelineVersions.decidedByName,
  decidedAt: pipelineVersions.decidedAt,
  decisionNote: pipelineVersions.decisionNote,
  createdAt: pipelineVersions.createdAt,
};

function omitDefinition(version: PipelineVersion): Omit<PipelineVersion, "definition"> {
  const copy: Partial<PipelineVersion> = { ...version };
  delete copy.definition;
  return copy as Omit<PipelineVersion, "definition">;
}

const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** Whether the actor may change a regular pipeline directly: a person who owns it, or holds `pipeline:manage`. */
export function canChangeRegular(ctx: Ctx, pipeline: Pick<Pipeline, "ownerUserId">): boolean {
  return ctx.actor.type === "user" && (pipeline.ownerUserId === ctx.actor.id || can(ctx.actor, "pipeline:manage"));
}

/** Refuses a change to a pipeline the actor may not make directly. */
function assertCanChange(ctx: Ctx, pipeline: Pipeline): void {
  assertCan(ctx, "pipeline:write");
  if (pipeline.kind === "adhoc" || canChangeRegular(ctx, pipeline)) return;
  throw forbidden(
    ctx.actor.type === "agent"
      ? `"${pipeline.name}" is a regular pipeline: its owner or an admin changes it. Propose a change with update_pipeline instead.`
      : `Only the owner of "${pipeline.name}" and the workspace's owners and admins can change it.`,
  );
}

async function assertActors(ctx: Ctx, definition: PipelineDefinition): Promise<void> {
  const problems = await actorProblems(ctx, definition);
  if (problems.length) throw invalid(problems.join("\n"));
}

/** Problems a pipeline's triggers have with its inputs: a schedule starts runs with none, an event with the captured task's. */
function triggerProblems(definition: PipelineDefinition, triggers: TriggersInput): string[] {
  const required = definition.inputs.filter((input) => input.required);
  const problems: string[] = [];
  if (triggers.schedule && required.length) {
    problems.push(`A scheduled run starts with no inputs, but this pipeline requires ${required.map((input) => `"${input.name}"`).join(", ")}. Make them optional, or drop the schedule.`);
  }
  const beyondEvent = required.filter((input) => !(EVENT_INPUTS as readonly string[]).includes(input.name));
  if (triggers.events.length && beyondEvent.length) {
    problems.push(`A run started by an event gets only ${EVENT_INPUTS.join(", ")}, but this pipeline requires ${beyondEvent.map((input) => `"${input.name}"`).join(", ")}.`);
  }
  return problems;
}

/** Replaces a pipeline's triggers. A webhook that stays on keeps its secret; one turned on gets a new one, returned once. */
async function saveTriggers(ctx: Ctx, pipelineId: string, triggers: TriggersInput): Promise<string | undefined> {
  const [webhook] = await ctx.db
    .select({ id: pipelineTriggers.id })
    .from(pipelineTriggers)
    .where(and(inTenant(ctx, pipelineTriggers), eq(pipelineTriggers.pipelineId, pipelineId), eq(pipelineTriggers.kind, "webhook")));
  await ctx.db
    .delete(pipelineTriggers)
    .where(and(inTenant(ctx, pipelineTriggers), eq(pipelineTriggers.pipelineId, pipelineId), triggers.webhook ? ne(pipelineTriggers.kind, "webhook") : undefined));
  const base = { tenantId: ctx.tenant.id, pipelineId };
  const rows: (typeof pipelineTriggers.$inferInsert)[] = [
    ...(triggers.schedule ? [{ ...base, id: newId("tr"), kind: "schedule" as const, cron: triggers.schedule.cron, timeZone: triggers.schedule.timeZone }] : []),
    ...triggers.events.map((event) => ({ ...base, id: newId("tr"), kind: "event" as const, tag: event.tag ?? null, source: event.source ?? null })),
  ];
  let secret: string | undefined;
  if (triggers.webhook && !webhook) {
    secret = `pht_${randomBytes(32).toString("base64url")}`;
    rows.push({ ...base, id: newId("tr"), kind: "webhook", secretHash: hashSecret(secret) });
  }
  if (rows.length) await ctx.db.insert(pipelineTriggers).values(rows);
  return secret;
}

export async function triggersOf(ctx: Ctx, pipelineId: string): Promise<PipelineTriggers> {
  const rows = await ctx.db
    .select()
    .from(pipelineTriggers)
    .where(and(inTenant(ctx, pipelineTriggers), eq(pipelineTriggers.pipelineId, pipelineId)))
    .orderBy(asc(pipelineTriggers.createdAt));
  const schedule = rows.find((row) => row.kind === "schedule");
  return {
    schedule: schedule?.cron && schedule.timeZone ? { cron: schedule.cron, timeZone: schedule.timeZone, lastFiredAt: schedule.lastFiredAt } : null,
    events: rows.filter((row) => row.kind === "event").map((row) => ({ tag: row.tag, source: row.source as Source | null })),
    webhook: rows.some((row) => row.kind === "webhook") ? { url: routes.pipelineTrigger(pipelineId) } : null,
  };
}

/** How a person or an agent starting a run is recorded. */
function startedBy(ctx: Ctx, options: z.output<typeof RunOptionsInput>): RunStart {
  return {
    trigger: ctx.actor.type === "user" ? "manual" : "agent",
    by: { type: ctx.actor.type, id: ctx.actor.id, name: ctx.actor.name },
    name: options.name,
    inputs: options.inputs,
    taskId: options.taskId,
    goalId: options.goalId,
    strict: true,
  };
}

/** The person whose call a pipeline is: the person defining it, or the person who connected the agent defining it. */
async function ownerFor(ctx: Ctx): Promise<string | null> {
  if (ctx.actor.type === "user") return ctx.actor.id;
  const [agent] = await ctx.db.select({ createdByUserId: agents.createdByUserId, parentAgentId: agents.parentAgentId }).from(agents).where(tenantRow(ctx, agents, ctx.actor.id));
  if (agent?.createdByUserId || !agent?.parentAgentId) return agent?.createdByUserId ?? null;
  const [parent] = await ctx.db.select({ createdByUserId: agents.createdByUserId }).from(agents).where(tenantRow(ctx, agents, agent.parentAgentId));
  return parent?.createdByUserId ?? null;
}

/**
 * Defines a pipeline from a definition (checked whole: its shape, then that every agent and person
 * it names is in the workspace), at version 1. An ad hoc pipeline starts its run at once; a regular
 * one does when `run` is given. Triggers are for regular pipelines.
 */
export const definePipeline = service(DefinePipelineInput, async (ctx, input): Promise<PipelineChange> => {
  assertCan(ctx, "pipeline:write");
  const definition = normalizeDefinition(input.definition);
  await assertActors(ctx, definition);
  if (input.triggers && input.kind === "adhoc") throw invalid("An ad hoc pipeline runs once, so it takes no triggers. Define it as regular to start runs on a schedule, an event or a webhook.");
  if (input.triggers) {
    const problems = triggerProblems(definition, input.triggers);
    if (problems.length) throw invalid(problems.join("\n"));
  }
  const ownerUserId = await ownerFor(ctx);

  return inTransaction(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(pipelines)
      .values({ id: newId("p"), tenantId: tx.tenant.id, name: input.name, kind: input.kind, description: input.description, ownerUserId, currentVersion: 1, ...createdByFields(tx.actor) })
      .returning(pipelineColumns);
    const pipeline = row!;
    await tx.db.insert(pipelineVersions).values({ tenantId: tx.tenant.id, pipelineId: pipeline.id, number: 1, definition, ...createdByFields(tx.actor) });
    const webhookSecret = input.triggers ? await saveTriggers(tx, pipeline.id, input.triggers) : undefined;
    await recordEvent(tx, {
      action: "pipeline.defined",
      entityType: "pipeline",
      entityId: pipeline.id,
      summary: `defined the ${input.kind === "adhoc" ? "ad hoc " : ""}pipeline "${pipeline.name}" (${definition.stops.length} stops)`,
      data: { pipelineId: pipeline.id, kind: pipeline.kind },
    });
    await trackAfterCommit(tx, {
      name: "pipeline_create",
      params: { kind: pipeline.kind, template: templateOf(definition), ...pipelineShape(definition), created_by: tx.actor.type === "user" ? "person" : "agent" },
    });
    const run = input.kind === "adhoc" || input.run ? await beginRun(tx, pipeline.id, startedBy(tx, input.run ?? RunOptionsInput.parse({}))) : undefined;
    return { pipeline, definition, triggers: await triggersOf(tx, pipeline.id), ...(webhookSecret && { webhookSecret }), ...(run && { run }) };
  });
});

async function nextVersionNumber(ctx: Ctx, pipelineId: string): Promise<number> {
  const [row] = await ctx.db.select({ number: max(pipelineVersions.number) }).from(pipelineVersions).where(and(inTenant(ctx, pipelineVersions), eq(pipelineVersions.pipelineId, pipelineId)));
  return (row?.number ?? 0) + 1;
}

/**
 * Changes a pipeline: its name, description, definition (a new version; running trips keep theirs)
 * or triggers. On a regular pipeline only its owner or an admin changes it directly; an agent's change
 * becomes a proposal (`proposal` in the result) that one of them approves or rejects. Agents propose
 * the definition, name and description; triggers stay with people.
 */
export const updatePipeline = service(UpdatePipelineInput, async (ctx, input): Promise<PipelineChange> => {
  assertCan(ctx, "pipeline:write");
  const current = await findPipeline(ctx, input.pipelineId);
  if (current.status === "archived") throw conflict(`"${current.name}" is archived. Define a new pipeline instead.`);
  if (input.name === undefined && input.description === undefined && input.definition === undefined && input.triggers === undefined) {
    throw invalid("Nothing to update: pass name, description, definition or triggers.");
  }
  if (input.triggers && current.kind === "adhoc") throw invalid("An ad hoc pipeline runs once, so it takes no triggers.");
  const definition = input.definition ? normalizeDefinition(input.definition) : await loadDefinition(ctx, current.id, current.currentVersion);
  if (input.definition) await assertActors(ctx, definition);
  if (input.triggers) {
    const problems = triggerProblems(definition, input.triggers);
    if (problems.length) throw invalid(problems.join("\n"));
  }
  const direct = current.kind === "adhoc" || canChangeRegular(ctx, current);
  if (!direct && ctx.actor.type === "user") assertCanChange(ctx, current);

  return inTransaction(ctx, async (tx) => {
    const pipeline = await findPipeline(tx, current.id, { lock: true });
    const number = await nextVersionNumber(tx, pipeline.id);
    if (!direct) {
      if (input.triggers) throw forbidden(`A regular pipeline's triggers are for its owner or an admin to set. Propose the change to the stops instead, or ask them.`);
      const [row] = await tx.db
        .insert(pipelineVersions)
        .values({
          tenantId: tx.tenant.id,
          pipelineId: pipeline.id,
          number,
          definition,
          ...createdByFields(tx.actor),
          reason: input.reason,
          proposalState: "proposed",
          baseVersion: pipeline.currentVersion,
          settings: { ...(input.name !== undefined && { name: input.name }), ...(input.description !== undefined && { description: input.description }) },
        })
        .returning(versionColumns);
      await recordEvent(tx, {
        action: "pipeline.version_proposed",
        entityType: "pipeline",
        entityId: pipeline.id,
        summary: `proposed version ${number} of "${pipeline.name}"${input.reason ? `: ${input.reason.slice(0, 160)}` : ""}`,
        data: { pipelineId: pipeline.id, version: number },
      });
      return { pipeline, definition: await loadDefinition(tx, pipeline.id, pipeline.currentVersion), triggers: await triggersOf(tx, pipeline.id), proposal: row! };
    }
    if (input.definition) {
      await tx.db.insert(pipelineVersions).values({ tenantId: tx.tenant.id, pipelineId: pipeline.id, number, definition, ...createdByFields(tx.actor), reason: input.reason });
    }
    const patch = { ...(input.name !== undefined && { name: input.name }), ...(input.description !== undefined && { description: input.description }), ...(input.definition && { currentVersion: number }) };
    const [row] = Object.keys(patch).length ? await tx.db.update(pipelines).set(patch).where(tenantRow(tx, pipelines, pipeline.id)).returning(pipelineColumns) : [pipeline];
    const webhookSecret = input.triggers ? await saveTriggers(tx, pipeline.id, input.triggers) : undefined;
    const changed = [...Object.keys(patch).filter((key) => key !== "currentVersion"), ...(input.definition ? ["definition"] : []), ...(input.triggers ? ["triggers"] : [])];
    await recordEvent(tx, {
      action: "pipeline.updated",
      entityType: "pipeline",
      entityId: pipeline.id,
      summary: input.definition ? `saved version ${number} of "${row?.name ?? pipeline.name}"` : `changed "${row?.name ?? pipeline.name}" (${changed.join(", ")})`,
      data: { pipelineId: pipeline.id, changed, ...(input.definition && { version: number }) },
    });
    return { pipeline: row!, definition, triggers: await triggersOf(tx, pipeline.id), ...(webhookSecret && { webhookSecret }) };
  });
});

async function proposalFor(ctx: Ctx, pipeline: Pipeline, version: number): Promise<PipelineVersion> {
  if (ctx.actor.type !== "user") throw forbidden("Only a person approves or rejects a proposed change to a pipeline.");
  assertCanChange(ctx, pipeline);
  const [row] = await ctx.db
    .select(versionColumns)
    .from(pipelineVersions)
    .where(and(inTenant(ctx, pipelineVersions), eq(pipelineVersions.pipelineId, pipeline.id), eq(pipelineVersions.number, version)))
    .for("update");
  if (!row) throw notFound(`version ${version} of pipeline`, pipeline.id);
  if (row.proposalState !== "proposed") throw conflict(`Version ${version} of "${pipeline.name}" is ${row.proposalState ? `already ${row.proposalState}` : "not a proposal"}.`);
  return row;
}

/** A person approves an agent's proposed version: it becomes current (with any name or description it proposed). */
export const approvePipelineVersion = service(PipelineVersionRefInput, async (ctx, { pipelineId, version }): Promise<PipelineChange> =>
  inTransaction(ctx, async (tx) => {
    const pipeline = await findPipeline(tx, pipelineId, { lock: true });
    const proposal = await proposalFor(tx, pipeline, version);
    if (proposal.baseVersion !== pipeline.currentVersion) {
      throw conflict(`Version ${version} was proposed against version ${proposal.baseVersion}, and "${pipeline.name}" is at version ${pipeline.currentVersion} now. Reject it, and ask for a proposal from the current version.`);
    }
    await assertActors(tx, proposal.definition);
    const [decided] = await tx.db
      .update(pipelineVersions)
      .set({ proposalState: "approved", decidedByUserId: tx.actor.id, decidedByName: tx.actor.name, decidedAt: new Date() })
      .where(and(inTenant(tx, pipelineVersions), eq(pipelineVersions.pipelineId, pipeline.id), eq(pipelineVersions.number, version)))
      .returning(versionColumns);
    const [row] = await tx.db
      .update(pipelines)
      .set({ currentVersion: version, ...proposal.settings })
      .where(tenantRow(tx, pipelines, pipeline.id))
      .returning(pipelineColumns);
    await recordEvent(tx, {
      action: "pipeline.version_approved",
      entityType: "pipeline",
      entityId: pipeline.id,
      summary: `approved version ${version} of "${row!.name}", proposed by ${proposal.createdByName}`,
      data: { pipelineId: pipeline.id, version, proposedById: proposal.createdById },
    });
    return { pipeline: row!, definition: proposal.definition, triggers: await triggersOf(tx, pipeline.id), proposal: decided! };
  }),
);

/** A person rejects an agent's proposed version, with why. */
export const rejectPipelineVersion = service(PipelineVersionRefInput, async (ctx, { pipelineId, version, note }): Promise<PipelineVersion> =>
  inTransaction(ctx, async (tx) => {
    const pipeline = await findPipeline(tx, pipelineId, { lock: true });
    const proposal = await proposalFor(tx, pipeline, version);
    const [decided] = await tx.db
      .update(pipelineVersions)
      .set({ proposalState: "rejected", decidedByUserId: tx.actor.id, decidedByName: tx.actor.name, decidedAt: new Date(), decisionNote: note })
      .where(and(inTenant(tx, pipelineVersions), eq(pipelineVersions.pipelineId, pipeline.id), eq(pipelineVersions.number, version)))
      .returning(versionColumns);
    await recordEvent(tx, {
      action: "pipeline.version_rejected",
      entityType: "pipeline",
      entityId: pipeline.id,
      summary: `rejected version ${version} of "${pipeline.name}", proposed by ${proposal.createdByName}${note ? `: ${note.slice(0, 160)}` : ""}`,
      data: { pipelineId: pipeline.id, version, proposedById: proposal.createdById },
    });
    return decided!;
  }),
);

const statusService = (status: Pipeline["status"]) =>
  service(PipelineRefInput, async (ctx, { pipelineId }): Promise<Pipeline> =>
    inTransaction(ctx, async (tx) => {
      const pipeline = await findPipeline(tx, pipelineId, { lock: true });
      assertCanChange(tx, pipeline);
      if (pipeline.status === "archived" && status !== "archived") throw conflict(`"${pipeline.name}" is archived. Define a new pipeline instead.`);
      return setPipelineStatus(tx, pipeline, status);
    }),
  );

/** Stops a pipeline's triggers and new runs; runs under way go on. */
export const pausePipeline = statusService("paused");
export const resumePipeline = statusService("active");
/** Files a pipeline away for good: no new runs; runs under way go on. */
export const archivePipeline = statusService("archived");

export const listPipelines = service(ListPipelinesInput, async (ctx, { kind, status, limit }): Promise<PipelineSummary[]> => {
  assertCan(ctx, "workspace:read");
  const rows = await ctx.db
    .select(pipelineColumns)
    .from(pipelines)
    .where(and(inTenant(ctx, pipelines), kind ? eq(pipelines.kind, kind) : undefined, status ? eq(pipelines.status, status) : ne(pipelines.status, "archived")))
    .orderBy(asc(pipelines.name))
    .limit(limit);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const counts = await ctx.db
    .select({
      pipelineId: pipelineRuns.pipelineId,
      total: sql<number>`count(*)::int`,
      live: sql<number>`count(*) filter (where ${inArray(pipelineRuns.status, [...LIVE_RUN_STATUSES])})::int`,
      waiting: sql<number>`count(*) filter (where ${pipelineRuns.status} = 'waiting')::int`,
    })
    .from(pipelineRuns)
    .where(and(inTenant(ctx, pipelineRuns), inArray(pipelineRuns.pipelineId, ids)))
    .groupBy(pipelineRuns.pipelineId);
  const last = await ctx.db
    .selectDistinctOn([pipelineRuns.pipelineId], { pipelineId: pipelineRuns.pipelineId, id: pipelineRuns.id, number: pipelineRuns.number, status: pipelineRuns.status, startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(and(inTenant(ctx, pipelineRuns), inArray(pipelineRuns.pipelineId, ids)))
    .orderBy(pipelineRuns.pipelineId, desc(pipelineRuns.number));
  return rows.map((pipeline) => {
    const count = counts.find((entry) => entry.pipelineId === pipeline.id);
    const latest = last.find((entry) => entry.pipelineId === pipeline.id);
    return {
      ...pipeline,
      runs: { total: count?.total ?? 0, live: count?.live ?? 0, waiting: count?.waiting ?? 0 },
      lastRun: latest ? { id: latest.id, number: latest.number, status: latest.status, startedAt: latest.startedAt } : null,
    };
  });
});

export const getPipeline = service(PipelineRefInput, async (ctx, { pipelineId }): Promise<PipelineDetail> => {
  assertCan(ctx, "workspace:read");
  const pipeline = await findPipeline(ctx, pipelineId);
  const versions = await ctx.db
    .select(versionColumns)
    .from(pipelineVersions)
    .where(and(inTenant(ctx, pipelineVersions), eq(pipelineVersions.pipelineId, pipeline.id)))
    .orderBy(desc(pipelineVersions.number));
  const recentRuns = await ctx.db
    .select(runColumns)
    .from(pipelineRuns)
    .where(and(inTenant(ctx, pipelineRuns), eq(pipelineRuns.pipelineId, pipeline.id)))
    .orderBy(desc(pipelineRuns.number))
    .limit(10);
  return {
    pipeline,
    definition: versions.find((version) => version.number === pipeline.currentVersion)!.definition,
    versions: versions.map((version) => omitDefinition(version)),
    proposals: versions.filter((version) => version.proposalState === "proposed"),
    triggers: await triggersOf(ctx, pipeline.id),
    recentRuns,
  };
});

/** Starts a run of a pipeline, by a person (`manual`) or an agent (`agent`). */
export const startRun = service(StartRunInput, async (ctx, { pipelineId, ...options }): Promise<RunView> => {
  assertCan(ctx, "pipeline:write");
  const pipeline = await findPipeline(ctx, pipelineId);
  if (pipeline.kind === "factory") throw invalid("Factories are not available yet.");
  const run = await beginRun(ctx, pipeline.id, startedBy(ctx, options));
  return runView(ctx, run.id);
});

/** One run, with every stop's state, task and result. Time limits that are due are applied first. */
export const getRun = service(RunRefInput, async (ctx, { runId }): Promise<RunView> => {
  assertCan(ctx, "workspace:read");
  await findRun(ctx, runId);
  await sweepDeadlines(ctx, { runId });
  return runView(ctx, runId);
});

/** A run in a list, with its pipeline's name. */
export type RunSummary = PipelineRun & { pipelineName: string; pipelineKind: PipelineKind };

export const listRuns = service(ListRunsInput, async (ctx, { pipelineId, status, limit }): Promise<RunSummary[]> => {
  assertCan(ctx, "workspace:read");
  await sweepDeadlines(ctx);
  const rows = await ctx.db
    .select({ run: runColumns, pipelineName: pipelines.name, pipelineKind: pipelines.kind })
    .from(pipelineRuns)
    .innerJoin(pipelines, and(eq(pipelines.tenantId, pipelineRuns.tenantId), eq(pipelines.id, pipelineRuns.pipelineId)))
    .where(and(inTenant(ctx, pipelineRuns), pipelineId ? eq(pipelineRuns.pipelineId, pipelineId) : undefined, status ? eq(pipelineRuns.status, status) : undefined))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(limit);
  return rows.map(({ run, pipelineName, pipelineKind }) => ({ ...run, pipelineName, pipelineKind }));
});

/** Cancels a live run: its live stops are cancelled and their tasks dropped, then the run's own task. */
export const cancelRun = service(CancelRunInput, async (ctx, { runId, reason }): Promise<RunView> => {
  assertCan(ctx, "pipeline:write");
  const run = await findRun(ctx, runId);
  if (run.status === "done" || run.status === "failed") throw conflict(`Run ${run.number} has already ended (${run.status}).`);
  await endRun(ctx, runId, reason);
  return runView(ctx, runId);
});

/**
 * Names a run, or clears its name (null): what it makes, shown wherever it appears. The run's own task
 * takes the new name too, while it still carries the run's old one.
 */
export const updateRun = service(UpdateRunInput, async (ctx, { runId, name }): Promise<RunView> => {
  assertCan(ctx, "pipeline:write");
  if (name === undefined) throw invalid("Nothing to update: pass name (null clears it).");
  await inTransaction(ctx, async (tx) => {
    const run = await findRun(tx, runId, { lock: true });
    // Kept to one line and the limit, as at start.
    const next = name ? clipRunName(name) || null : null;
    if (next === run.name) throw invalid(next ? `Run ${run.number} is already called "${next}".` : `Run ${run.number} has no name to clear.`);
    const pipeline = await findPipeline(tx, run.pipelineId);
    await tx.db.update(pipelineRuns).set({ name: next }).where(tenantRow(tx, pipelineRuns, run.id));
    if (run.taskId) {
      const [task] = await tx.db.select({ title: tasks.title }).from(tasks).where(tenantRow(tx, tasks, run.taskId));
      const before = run.name ?? `${pipeline.name} #${run.number}`;
      // Through the task service, as the pipeline, so the change is logged and the task's watchers hear it.
      if (task?.title === before) await updateTask(await pipelineContext(tx, pipeline.name), { taskId: run.taskId, title: next ?? `${pipeline.name} #${run.number}` });
    }
    await recordEvent(tx, {
      action: "pipeline.run_renamed",
      entityType: "pipeline_run",
      entityId: run.id,
      summary: next ? `named ${pipeline.name} #${run.number} “${next}”` : `cleared the name of ${runTitle(run, pipeline.name)}`,
      data: { pipelineId: pipeline.id, runId: run.id, taskId: run.taskId, number: run.number, runName: next },
    });
  });
  return runView(ctx, runId);
});

/**
 * Sends an agent stop's handoff again now, while it still waits on its agent, for a bot that missed it: the
 * agent hears `task.handoff_retried` as `handed_to_you`, with `trigger: manual` and who resent it.
 * It leaves the automatic resends' schedule as it was.
 */
export const resendHandoff = service(ResendHandoffInput, async (ctx, { runId, stopId }): Promise<HandoffResend> => {
  assertCan(ctx, "pipeline:write");
  return resendStopHandoff(ctx, runId, stopId);
});

/** A stop whose handoff no one picked up: where it is, who it waits on, since when, and how often it was resent. */
export interface StuckStop {
  pipelineId: string;
  pipelineName: string;
  runId: string;
  runNumber: number;
  runName: string | null;
  stopId: string;
  stopName: string;
  taskId: string;
  agent: { id: string; name: string } | null;
  handedOffAt: Date;
  resends: number;
  /** When the tick gave up resending: the stop needs a person. */
  gaveUpAt: Date | null;
}

/** Stuck stops, longest waiting first: live agent stops whose handoff still waits on its agent, past the first resend's time. */
export const listStuckStops = service(ListStuckStopsInput, async (ctx, { pipelineId, limit }): Promise<StuckStop[]> => {
  assertCan(ctx, "workspace:read");
  const now = new Date();
  const rows = await ctx.db
    .select({
      runId: pipelineRunStops.runId,
      stopId: pipelineRunStops.stopId,
      taskId: pipelineRunStops.taskId,
      state: pipelineRunStops.state,
      handedOffAt: pipelineRunStops.handedOffAt,
      handoffAgentId: pipelineRunStops.handoffAgentId,
      resends: pipelineRunStops.handoffResends,
      gaveUpAt: pipelineRunStops.handoffGaveUpAt,
      delegation: tasks.delegation,
      delegateToAgentId: tasks.delegateToAgentId,
      delegatedAt: tasks.delegatedAt,
      run: { number: pipelineRuns.number, name: pipelineRuns.name, version: pipelineRuns.version, pipelineId: pipelineRuns.pipelineId },
      pipelineName: pipelines.name,
      agentName: agents.name,
    })
    .from(pipelineRunStops)
    .innerJoin(tasks, and(eq(tasks.tenantId, pipelineRunStops.tenantId), eq(tasks.id, pipelineRunStops.taskId)))
    .innerJoin(pipelineRuns, and(eq(pipelineRuns.tenantId, pipelineRunStops.tenantId), eq(pipelineRuns.id, pipelineRunStops.runId)))
    .innerJoin(pipelines, and(eq(pipelines.tenantId, pipelineRuns.tenantId), eq(pipelines.id, pipelineRuns.pipelineId)))
    .leftJoin(agents, and(eq(agents.tenantId, pipelineRunStops.tenantId), eq(agents.id, pipelineRunStops.handoffAgentId), isNull(agents.revokedAt)))
    .where(
      and(
        inTenant(ctx, pipelineRunStops),
        isNull(pipelineRunStops.supersededAt),
        inArray(pipelineRunStops.state, ["active", "waiting"]),
        // Stuck, as `isStuckHandoff` reads it, before the limit: the handoff the row records still waits
        // on its agent (the same agent, the same handoff), and the first resend's time has passed.
        eq(tasks.delegation, "handing_off"),
        eq(tasks.delegateToAgentId, pipelineRunStops.handoffAgentId),
        eq(tasks.delegatedAt, pipelineRunStops.handedOffAt),
        lte(pipelineRunStops.handedOffAt, new Date(now.getTime() - HANDOFF_RETRY_FIRST_MINUTES * 60_000)),
        pipelineId ? eq(pipelineRuns.pipelineId, pipelineId) : undefined,
      ),
    )
    .orderBy(asc(pipelineRunStops.handedOffAt))
    .limit(limit);
  const definitions = new Map<string, PipelineDefinition>();
  const out: StuckStop[] = [];
  for (const row of rows) {
    const task = { delegation: row.delegation, delegateToAgentId: row.delegateToAgentId, delegatedAt: row.delegatedAt };
    if (!isStuckHandoff({ live: true, handedOffAt: row.handedOffAt, handoffAgentId: row.handoffAgentId, task }, now)) continue;
    const key = `${row.run.pipelineId}:${row.run.version}`;
    if (!definitions.has(key)) definitions.set(key, await loadDefinition(ctx, row.run.pipelineId, row.run.version));
    const stop = definitions.get(key)!.stops.find((candidate) => candidate.id === row.stopId);
    out.push({
      pipelineId: row.run.pipelineId,
      pipelineName: row.pipelineName,
      runId: row.runId,
      runNumber: row.run.number,
      runName: row.run.name,
      stopId: row.stopId,
      stopName: stop?.name ?? row.stopId,
      taskId: row.taskId!,
      agent: row.handoffAgentId && row.agentName ? { id: row.handoffAgentId, name: row.agentName } : null,
      handedOffAt: row.handedOffAt!,
      resends: row.resends,
      gaveUpAt: row.gaveUpAt,
    });
  }
  return out;
});

/** Runs a stop again, and every stop after it, on fresh subtasks; a run that had ended runs again. */
export const rerunFrom = service(RerunFromInput, async (ctx, { runId, stopId, note }): Promise<RunView> => {
  assertCan(ctx, "pipeline:write");
  await rerunRun(ctx, runId, stopId, note);
  return runView(ctx, runId);
});

// Reads for the app's pages

/** How many of a pipeline's latest runs its row on the Pipelines tab shows as dots. */
export const RUN_STRIP = 20;

/** A run as a dot on a pipeline's strip. */
export type StripRun = Pick<PipelineRun, "id" | "number" | "name" | "status" | "startedAt" | "endedAt">;

/** A pipeline on the Pipelines tab: its summary, its latest runs, and when its schedule fires next. */
export type PipelineBoardRow = PipelineSummary & {
  strip: StripRun[];
  /** The current version's stops in order, and the inputs a run takes. */
  line: { id: string; name: string; kind: PipelineDefinition["stops"][number]["kind"] }[];
  inputs: PipelineDefinition["inputs"];
  schedule: PipelineTriggers["schedule"];
  nextRunAt: Date | null;
};

/** Every pipeline (archived ones only when asked for) with its last runs as a strip and its next scheduled run. */
export const listPipelineBoard = service(ListPipelinesInput, async (ctx, input): Promise<PipelineBoardRow[]> => {
  const summaries = await listPipelines(ctx, input);
  if (summaries.length === 0) return [];
  const ids = summaries.map((pipeline) => pipeline.id);
  const latest = sql`(select max(r2.number) from ${pipelineRuns} r2 where r2.tenant_id = ${ctx.tenant.id} and r2.pipeline_id = ${pipelineRuns.pipelineId})`;
  const strips = await ctx.db
    .select({ pipelineId: pipelineRuns.pipelineId, id: pipelineRuns.id, number: pipelineRuns.number, name: pipelineRuns.name, status: pipelineRuns.status, startedAt: pipelineRuns.startedAt, endedAt: pipelineRuns.endedAt })
    .from(pipelineRuns)
    .where(and(inTenant(ctx, pipelineRuns), inArray(pipelineRuns.pipelineId, ids), sql`${pipelineRuns.number} > ${latest} - ${RUN_STRIP}`))
    .orderBy(desc(pipelineRuns.number));
  const schedules = await ctx.db
    .select({ pipelineId: pipelineTriggers.pipelineId, cron: pipelineTriggers.cron, timeZone: pipelineTriggers.timeZone, lastFiredAt: pipelineTriggers.lastFiredAt })
    .from(pipelineTriggers)
    .where(and(inTenant(ctx, pipelineTriggers), inArray(pipelineTriggers.pipelineId, ids), eq(pipelineTriggers.kind, "schedule")));
  const versions = await ctx.db
    .select({ pipelineId: pipelineVersions.pipelineId, number: pipelineVersions.number, definition: pipelineVersions.definition })
    .from(pipelineVersions)
    .innerJoin(pipelines, and(eq(pipelines.tenantId, pipelineVersions.tenantId), eq(pipelines.id, pipelineVersions.pipelineId), eq(pipelines.currentVersion, pipelineVersions.number)))
    .where(and(inTenant(ctx, pipelineVersions), inArray(pipelineVersions.pipelineId, ids)));
  const now = new Date();
  return summaries.map((pipeline) => {
    const definition = versions.find((version) => version.pipelineId === pipeline.id)?.definition;
    const byId = new Map(definition?.stops.map((stop) => [stop.id, stop]));
    const found = schedules.find((entry) => entry.pipelineId === pipeline.id);
    const schedule = found?.cron && found.timeZone ? { cron: found.cron, timeZone: found.timeZone, lastFiredAt: found.lastFiredAt } : null;
    return {
      ...pipeline,
      strip: strips.filter((run) => run.pipelineId === pipeline.id).map(({ id, number, name, status, startedAt, endedAt }) => ({ id, number, name, status, startedAt, endedAt })),
      line: definition ? stopOrder(definition).map((id) => ({ id, name: byId.get(id)!.name, kind: byId.get(id)!.kind })) : [],
      inputs: definition?.inputs ?? [],
      schedule,
      nextRunAt: schedule && pipeline.status === "active" ? nextFiring(schedule.cron, schedule.timeZone, now) : null,
    };
  });
});

/** A run in a pipeline's history: its stop rows (reruns and hand-backs included) for the grid and insights. */
export type RunHistory = RunRecord & Pick<PipelineRun, "name" | "trigger" | "triggeredByName" | "taskId" | "summary">;

/** A pipeline's latest runs, newest first, each with every stop row it has had. */
export const pipelineHistory = service(PipelineHistoryInput, async (ctx, { pipelineId, limit }): Promise<RunHistory[]> => {
  assertCan(ctx, "workspace:read");
  const pipeline = await findPipeline(ctx, pipelineId);
  await sweepDeadlines(ctx);
  const runs = await ctx.db
    .select(runColumns)
    .from(pipelineRuns)
    .where(and(inTenant(ctx, pipelineRuns), eq(pipelineRuns.pipelineId, pipeline.id)))
    .orderBy(desc(pipelineRuns.number))
    .limit(limit);
  if (runs.length === 0) return [];
  const rows = await ctx.db
    .select({
      runId: pipelineRunStops.runId,
      stopId: pipelineRunStops.stopId,
      state: pipelineRunStops.state,
      attempt: pipelineRunStops.attempt,
      startedAt: pipelineRunStops.startedAt,
      endedAt: pipelineRunStops.endedAt,
      supersededAt: pipelineRunStops.supersededAt,
      branch: pipelineRunStops.branch,
      taskStatus: tasks.status,
    })
    .from(pipelineRunStops)
    .leftJoin(tasks, and(eq(tasks.tenantId, pipelineRunStops.tenantId), eq(tasks.id, pipelineRunStops.taskId)))
    .where(and(inTenant(ctx, pipelineRunStops), inArray(pipelineRunStops.runId, runs.map((run) => run.id))))
    .orderBy(asc(pipelineRunStops.startedAt));
  return runs.map((run) => ({
    id: run.id,
    number: run.number,
    name: run.name,
    version: run.version,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    endName: run.endName,
    trigger: run.trigger,
    triggeredByName: run.triggeredByName,
    taskId: run.taskId,
    summary: run.summary,
    stops: rows
      .filter((row) => row.runId === run.id)
      .map((row) => ({ stopId: row.stopId, state: row.state, attempt: row.attempt, startedAt: row.startedAt, endedAt: row.endedAt, superseded: Boolean(row.supersededAt), branch: row.branch, taskStatus: row.taskStatus ?? null })),
  }));
});

/** One version of a pipeline with its definition: to read an older one, or diff it against the one before. */
export const getPipelineVersion = service(PipelineVersionInput, async (ctx, { pipelineId, version }): Promise<PipelineVersion> => {
  assertCan(ctx, "workspace:read");
  const pipeline = await findPipeline(ctx, pipelineId);
  const [row] = await ctx.db
    .select(versionColumns)
    .from(pipelineVersions)
    .where(and(inTenant(ctx, pipelineVersions), eq(pipelineVersions.pipelineId, pipeline.id), eq(pipelineVersions.number, version)));
  if (!row) throw notFound(`version ${version} of pipeline`, pipeline.id);
  return row;
});

/** What a pipeline's decision shows on the Decisions page beside its options. */
export interface PipelineRequestContext {
  pipelineId: string;
  pipelineName: string;
  runId: string;
  runNumber: number;
  /** The run's name now, if it has one. */
  runName: string | null;
  stopName: string;
  /** "Stop 3 of 5". */
  position: { index: number; total: number } | null;
  /** What each option leads to, in words: "Send (Grok Bot)", "Ends: Sent". */
  steps: { option: string; next: string }[];
  /** When the time limit runs out, and the option taken then. */
  dueAt: Date | null;
  onTimeout: string | null;
}

/**
 * Where each pipeline decision stands, keyed by run and stop (`${runId}:${stopId}`): its place on the
 * line, what each option leads to, and its time limit. A decision whose run is gone is left out.
 */
export const describePipelineRequests = service(PipelineRequestsInput, async (ctx, { requests }): Promise<Record<string, PipelineRequestContext>> => {
  assertCan(ctx, "workspace:read");
  const out: Record<string, PipelineRequestContext> = {};
  const definitions = new Map<string, PipelineDefinition>();
  for (const { runId, stopId } of requests) {
    const [run] = await ctx.db.select(runColumns).from(pipelineRuns).where(tenantRow(ctx, pipelineRuns, runId));
    if (!run) continue;
    const key = `${run.pipelineId}:${run.version}`;
    if (!definitions.has(key)) definitions.set(key, await loadDefinition(ctx, run.pipelineId, run.version));
    const definition = definitions.get(key)!;
    const stop = definition.stops.find((candidate) => candidate.id === stopId);
    if (!stop) continue;
    const [pipeline] = await ctx.db.select({ name: pipelines.name }).from(pipelines).where(tenantRow(ctx, pipelines, run.pipelineId));
    const [row] = await ctx.db
      .select({ dueAt: pipelineRunStops.dueAt, recovering: pipelineRunStops.recovering })
      .from(pipelineRunStops)
      .where(and(inTenant(ctx, pipelineRunStops), eq(pipelineRunStops.runId, run.id), eq(pipelineRunStops.stopId, stopId), sql`${pipelineRunStops.supersededAt} is null`));
    const options = row?.recovering ? [] : stop.options.length ? stop.options : stop.then.choice?.map((branch) => branch.label) ?? [];
    const steps = await Promise.all(
      options.map(async (option) => {
        const target = nextStepFor(definition, stopId, option);
        const next = !target
          ? "Asks again"
          : target.kind === "end"
            ? `Ends: ${target.name}`
            : target.kind === "fork"
              ? target.stops.map((next) => next.name).join(" and ")
              : `${target.stop.name} (${await servedByOf(ctx, target.stop)})`;
        return { option, next };
      }),
    );
    out[`${runId}:${stopId}`] = {
      pipelineId: run.pipelineId,
      pipelineName: pipeline?.name ?? "",
      runId: run.id,
      runNumber: run.number,
      runName: run.name,
      stopName: stop.name,
      position: stopPosition(definition, stopId),
      steps,
      dueAt: row?.dueAt ?? null,
      onTimeout: row?.recovering ? null : (stop.onTimeout ?? null),
    };
  }
  return out;
});

/** Where a task sits on a pipeline's line: the run it carries, or the stop it serves. */
export interface TaskLine {
  /** The task carries the whole run, or serves one stop of it. */
  role: "run" | "stop";
  pipeline: { id: string; name: string };
  run: { id: string; number: number; name: string | null; status: RunStatus; headline: string };
  /** The run's stops in order; `current` marks the one this task serves. */
  stops: { stopId: string; name: string; state: ReturnType<typeof stopViewState>; taskId: string | null; current: boolean }[];
}

/** The line a task is on, if it carries a run or serves (or once served) one of its stops; null otherwise. */
export const taskLine = service(TaskRefInput, async (ctx, { taskId }): Promise<TaskLine | null> => {
  assertCan(ctx, "workspace:read");
  const [carried] = await ctx.db.select({ id: pipelineRuns.id }).from(pipelineRuns).where(and(inTenant(ctx, pipelineRuns), eq(pipelineRuns.taskId, taskId)));
  const [served] = carried
    ? []
    : await ctx.db
        .select({ runId: pipelineRunStops.runId, stopId: pipelineRunStops.stopId })
        .from(pipelineRunStops)
        .where(and(inTenant(ctx, pipelineRunStops), eq(pipelineRunStops.taskId, taskId)))
        .orderBy(desc(pipelineRunStops.startedAt))
        .limit(1);
  const runId = carried?.id ?? served?.runId;
  if (!runId) return null;
  const view = await runView(ctx, runId);
  return {
    role: carried ? "run" : "stop",
    pipeline: { id: view.pipeline.id, name: view.pipeline.name },
    run: { id: view.run.id, number: view.run.number, name: view.run.name, status: view.run.status, headline: view.headline },
    stops: view.stops.map((stop) => ({
      stopId: stop.stopId,
      name: stop.name,
      state: stopViewState(stop.state, stop.task?.status),
      taskId: stop.task?.id ?? null,
      current: !carried && stop.stopId === served?.stopId,
    })),
  };
});

/** A run's activity: its own events and its tasks', newest first. */
export const getRunActivity = service(RunRefInput, async (ctx, { runId }): Promise<Activity[]> => {
  assertCan(ctx, "workspace:read");
  const run = await findRun(ctx, runId);
  const rows = await ctx.db.select({ taskId: pipelineRunStops.taskId }).from(pipelineRunStops).where(and(inTenant(ctx, pipelineRunStops), eq(pipelineRunStops.runId, run.id)));
  const taskIds = [...new Set([run.taskId, ...rows.map((row) => row.taskId)].filter((id): id is string => Boolean(id)))];
  return runActivity(ctx, run.id, taskIds);
});

/** The stops of a definition in the order a run meets them, with who serves each, in words. */
export async function stopsServedBy(ctx: Ctx, definition: PipelineDefinition): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const named = await stopAgents(ctx, definition);
  for (const id of stopOrder(definition)) {
    const stop = definition.stops.find((candidate) => candidate.id === id)!;
    out[id] = stop.kind === "agent" ? (named[id]?.name ?? stop.agent!) : await servedByOf(ctx, stop);
  }
  return out;
}

export { stopAgents };
