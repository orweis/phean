import { createHash, randomBytes } from "node:crypto";

import { and, asc, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { z } from "zod";

import { LIVE_RUN_STATUSES, type PipelineKind, type RunStatus, type Source } from "@/lib/domain";
import { normalizeDefinition, type PipelineDefinition } from "@/lib/pipelines";
import { routes } from "@/lib/routes";

import { newId } from "../db/ids";
import { agents, pipelineRuns, pipelines, pipelineTriggers, pipelineVersions, type PipelineVersionRow } from "../db/schema";
import { createdByFields, inTenant, inTransaction, tenantRow, type Ctx } from "./context";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { recordEvent } from "./events";
import {
  actorProblems,
  beginRun,
  endRun,
  EVENT_INPUTS,
  findPipeline,
  findRun,
  loadDefinition,
  pipelineColumns,
  rerunRun,
  runColumns,
  runView,
  setPipelineStatus,
  sweepDeadlines,
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
  ListRunsInput,
  PipelineRefInput,
  PipelineTriggersInput,
  PipelineVersionRefInput,
  RerunFromInput,
  RunOptionsInput,
  RunRefInput,
  StartRunInput,
  UpdatePipelineInput,
} from "./schemas";
import { service } from "./service";

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

export type { Pipeline, PipelineRun, RunStopView, RunView } from "./pipeline-engine";
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

/** Runs a stop again, and every stop after it, on fresh subtasks; a run that had ended runs again. */
export const rerunFrom = service(RerunFromInput, async (ctx, { runId, stopId, note }): Promise<RunView> => {
  assertCan(ctx, "pipeline:write");
  await rerunRun(ctx, runId, stopId, note);
  return runView(ctx, runId);
});
