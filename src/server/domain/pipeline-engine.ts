import { and, asc, desc, eq, inArray, isNull, lte, max, or, sql, type SQL } from "drizzle-orm";

import type { InputAnswer, PipelineRequestRef } from "@/lib/agent-sessions";
import { isOpenTaskStatus, LIVE_RUN_STATUSES, LIVE_STOP_STATES, type ApproverRole, type RunTrigger, type StopState } from "@/lib/domain";
import {
  branchNamed,
  descendantsOf,
  endReachedBy,
  latestFiring,
  matchBranch,
  planRun,
  predecessorsOf,
  renderTemplate,
  rollUp,
  stopOrder,
  type ChoiceBranch,
  type PipelineDefinition,
  type PipelineStop,
  type StopProgress,
  type TemplateScope,
} from "@/lib/pipelines";

import type { Db } from "../db/client";
import { publicColumns } from "../db/columns";
import { newId } from "../db/ids";
import {
  agents,
  documents,
  member,
  organization,
  pipelineRuns,
  pipelineRunStops,
  pipelines,
  pipelineTriggers,
  pipelineVersions,
  tasks,
  user,
  watches,
  type PipelineRow,
  type PipelineRunRow,
  type PipelineRunStopRow,
  type StopResult,
  type StopVote,
} from "../db/schema";
import { durationBucket } from "../analytics";
import { trackAfterCommit } from "./analytics";
import { inTenant, inTransaction, tenantRow, type Ctx, type Tenant } from "./context";
import { conflict, forbidden, invalid, isDomainError, notFound } from "./errors";
import { recordEvent } from "./events";
import { captureTasks, completeTask, findTask, handOffTask, markAnswerCollected, requestInput, resolveInput, tagPipelineRequest, updateTask, type Task } from "./tasks";

/**
 * The pipeline engine: deterministic, in Phean, no model in the loop. A run rides on a task of its
 * own; when it reaches a stop, the engine captures a subtask for it and hands it off by name to the
 * stop's agent (who hears `handed_to_you`), or asks the stop's person for a decision. When that
 * subtask is completed (or handed back, or its decision answered), the task services call back here
 * in the same transaction, and the engine records the stop's result and works out what is next
 * (`planRun`). Reaching a stop inserts its row under a unique key (one current row per run and
 * stop), and finishing one is a conditional update from a live state, so each happens exactly once
 * however many changes race; every advance also holds the run's row locked.
 *
 * The engine acts as the workspace's pipelines agent (`authKind` "system", created on first use,
 * never listed, with no credential), under the pipeline's name: people read "Weekly newsletter
 * handed off “Draft”", and a person stop's decision is asked by it, so the Decisions page shows the
 * pipeline as the asker and its answer comes back to the engine rather than to any connected agent.
 */

export type Pipeline = Omit<PipelineRow, "tenantId">;
export type PipelineRun = Omit<PipelineRunRow, "tenantId">;
export type RunStop = Omit<PipelineRunStopRow, "tenantId">;

const PIPELINES_AGENT_NAME = "Pipelines";
/** The options of the decision a failed stop with failure rule `ask` puts to a person. */
export const RECOVERY_OPTIONS = ["Retry", "Fail"] as const;
/** The inputs a run started by an event trigger gets, from the captured task. */
export const EVENT_INPUTS = ["task_id", "task_title", "task_description"] as const;

const LIVE = [...LIVE_STOP_STATES] as StopState[];
const isLiveState = (state: StopState) => LIVE.includes(state);
const stopsOfRun = (runId: string) => and(eq(pipelineRunStops.runId, runId), isNull(pipelineRunStops.supersededAt))!;

/** Keeps a note within `max` characters, line breaks and all. */
function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

// The pipelines agent

/** The workspace's pipelines agent, made the first time a pipeline runs there. */
export async function pipelinesAgentId(ctx: Ctx): Promise<string> {
  // A placeholder no real key hashes to: it also keeps one pipelines agent per workspace.
  const key = `system:pipelines:${ctx.tenant.id}`;
  const find = () => ctx.db.select({ id: agents.id }).from(agents).where(and(inTenant(ctx, agents), eq(agents.tokenHash, key)));
  const [found] = await find();
  if (found) return found.id;
  await ctx.db.insert(agents).values({ id: newId("ag"), tenantId: ctx.tenant.id, name: PIPELINES_AGENT_NAME, authKind: "system", tokenHash: key, accessLevel: "write" }).onConflictDoNothing();
  const [made] = await find();
  return made!.id;
}

/** Phean acting for a pipeline: the pipelines agent, under the pipeline's name, on `ctx`'s connection and transaction. */
export async function pipelineContext(ctx: Ctx, pipelineName: string): Promise<Ctx> {
  return { ...ctx, actor: { type: "agent", id: await pipelinesAgentId(ctx), name: pipelineName, role: "agent_write", system: true } };
}

/** A context for work Phean starts on its own in a workspace (a schedule, a webhook, the sweep). */
export function systemContext(db: Db, tenant: Tenant): Ctx {
  return { db, tenant, actor: { type: "agent", id: "", name: PIPELINES_AGENT_NAME, role: "agent_write", system: true } };
}

// Loading

export async function findPipeline(ctx: Ctx, pipelineId: string, { lock = false } = {}): Promise<Pipeline> {
  const query = ctx.db.select(pipelineColumns).from(pipelines).where(tenantRow(ctx, pipelines, pipelineId));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("pipeline", pipelineId);
  return row;
}

export const pipelineColumns = publicColumns(pipelines, ["tenantId"]);
export const runColumns = publicColumns(pipelineRuns, ["tenantId"]);
const stopColumns = publicColumns(pipelineRunStops, ["tenantId"]);

export async function loadDefinition(ctx: Ctx, pipelineId: string, version: number): Promise<PipelineDefinition> {
  const [row] = await ctx.db
    .select({ definition: pipelineVersions.definition })
    .from(pipelineVersions)
    .where(and(inTenant(ctx, pipelineVersions), eq(pipelineVersions.pipelineId, pipelineId), eq(pipelineVersions.number, version)));
  if (!row) throw notFound(`version ${version} of pipeline`, pipelineId);
  return row.definition;
}

export async function findRun(ctx: Ctx, runId: string, { lock = false } = {}): Promise<PipelineRun> {
  const query = ctx.db.select(runColumns).from(pipelineRuns).where(tenantRow(ctx, pipelineRuns, runId));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("run", runId);
  return row;
}

/** One run being moved on: the run (its row locked), its pipeline and pinned definition, and Phean acting for it. */
interface Trip {
  run: PipelineRun;
  pipeline: Pipeline;
  definition: PipelineDefinition;
  sys: Ctx;
  /** Notes for stops about to be reached again: a hand-back's reason, a rerun's instructions. */
  notes: Map<string, string>;
}

async function tripOf(ctx: Ctx, runId: string): Promise<Trip> {
  const run = await findRun(ctx, runId, { lock: true });
  const pipeline = await findPipeline(ctx, run.pipelineId);
  const definition = await loadDefinition(ctx, run.pipelineId, run.version);
  return { run, pipeline, definition, sys: await pipelineContext(ctx, pipeline.name), notes: new Map() };
}

async function currentStops(ctx: Ctx, runId: string): Promise<RunStop[]> {
  return ctx.db.select(stopColumns).from(pipelineRunStops).where(and(inTenant(ctx, pipelineRunStops), stopsOfRun(runId))).orderBy(asc(pipelineRunStops.startedAt));
}

function progressOf(rows: readonly RunStop[]): Map<string, StopProgress> {
  return new Map(rows.map((row) => [row.stopId, { state: row.state, branch: row.branch }]));
}

function stopOf(definition: PipelineDefinition, stopId: string): PipelineStop {
  const stop = definition.stops.find((candidate) => candidate.id === stopId);
  if (!stop) throw invalid(`This run's pipeline has no stop "${stopId}". get_run lists its stops.`);
  return stop;
}

async function lockStop(ctx: Ctx, rowId: string): Promise<RunStop | null> {
  const [row] = await ctx.db.select(stopColumns).from(pipelineRunStops).where(tenantRow(ctx, pipelineRunStops, rowId)).for("update");
  return row && !row.supersededAt ? row : null;
}

/** Moves a live stop's row on; nothing when another change already moved it (the exactly-once guard). */
async function settleRow(ctx: Ctx, rowId: string, set: Partial<typeof pipelineRunStops.$inferInsert>): Promise<RunStop | null> {
  const [row] = await ctx.db
    .update(pipelineRunStops)
    .set(set)
    .where(and(tenantRow(ctx, pipelineRunStops, rowId), inArray(pipelineRunStops.state, LIVE)))
    .returning(stopColumns);
  return row ?? null;
}

const runRef = (trip: Trip) => ({ pipelineId: trip.pipeline.id, runId: trip.run.id, taskId: trip.run.taskId, number: trip.run.number });
const tripName = (trip: Trip) => `${trip.pipeline.name} #${trip.run.number}`;

// Who serves a stop

/** A member by user id or email, or null. */
async function findMember(ctx: Ctx, ref: string): Promise<{ id: string; name: string; email: string } | null> {
  const [person] = await ctx.db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ctx.tenant.id), or(eq(user.id, ref), sql`lower(${user.email}) = lower(${ref})`)))
    .limit(1);
  return person ?? null;
}

/** Who decides: a named person, or anyone with a role. */
interface Approvers {
  person?: string;
  role?: ApproverRole;
}

function approversOf(trip: Trip, stop: PipelineStop, row: RunStop): Approvers {
  if (!row.recovering) return { person: stop.person, role: stop.role };
  const rule = stop.onFailure;
  if (rule.person || rule.role) return { person: rule.person, role: rule.role };
  return trip.pipeline.ownerUserId ? { person: trip.pipeline.ownerUserId } : { role: "admin" };
}

async function describeApprovers(ctx: Ctx, approvers: Approvers): Promise<string> {
  if (approvers.person) return (await findMember(ctx, approvers.person))?.name ?? approvers.person;
  return approvers.role === "admin" ? "an owner or admin" : "any member";
}

/** Refuses an answer from someone the stop does not ask: only people decide, and only the named person, or someone with the role. */
async function assertMayDecide(ctx: Ctx, approvers: Approvers, stopName: string): Promise<void> {
  if (ctx.actor.type !== "user") throw forbidden(`Only a person decides at "${stopName}".`);
  if (approvers.person) {
    const person = await findMember(ctx, approvers.person);
    if (person?.id !== ctx.actor.id) throw forbidden(`Only ${person?.name ?? approvers.person} decides at "${stopName}".`);
  }
  if (approvers.role === "admin" && ctx.actor.role !== "owner" && ctx.actor.role !== "admin") {
    throw forbidden(`Only an owner or admin decides at "${stopName}".`);
  }
}

/**
 * The problems with who serves each stop, in this workspace now: each agent stop names exactly one
 * connected agent (or sub-agent), and each person it names, to decide or to be asked on failure, is a member.
 */
export async function actorProblems(ctx: Ctx, definition: PipelineDefinition): Promise<string[]> {
  const problems: string[] = [];
  for (const stop of definition.stops) {
    if (stop.kind === "agent" && stop.agent) {
      const named = await ctx.db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            inTenant(ctx, agents),
            sql`${agents.authKind} <> 'system'`,
            isNull(agents.revokedAt),
            or(eq(agents.id, stop.agent), sql`lower(${agents.name}) = lower(${stop.agent})`),
          ),
        )
        .limit(5);
      if (named.length === 0) problems.push(`Stop "${stop.id}": no connected agent is named or has the id "${stop.agent}". Use the name the Agents page shows.`);
      else if (named.length > 1 && !named.some((agent) => agent.id === stop.agent)) {
        problems.push(`Stop "${stop.id}": several agents are named "${stop.agent}" (${named.map((agent) => agent.id).join(", ")}); give the id of the one you mean.`);
      }
    }
    for (const ref of [stop.person, stop.onFailure.person]) {
      if (ref && !(await findMember(ctx, ref))) problems.push(`Stop "${stop.id}": "${ref}" is not a member of this workspace. Give a member's email or user id.`);
    }
  }
  return problems;
}

// What a stop is handed

async function documentsOf(ctx: Ctx, taskId: string | null): Promise<StopResult["documents"]> {
  if (!taskId) return [];
  return ctx.db
    .select({ id: documents.id, title: documents.title, format: documents.format })
    .from(documents)
    .where(and(inTenant(ctx, documents), eq(documents.taskId, taskId)))
    .orderBy(asc(documents.createdAt));
}

function scopeOf(trip: Trip, rows: readonly RunStop[]): TemplateScope {
  return {
    input: trip.run.inputs,
    stops: Object.fromEntries(rows.filter((row) => row.result).map((row) => [row.stopId, { result: row.result!.note, answer: row.result!.answer ?? "" }])),
    run: { number: trip.run.number },
    pipeline: { name: trip.pipeline.name },
  };
}

function resultLine(name: string, result: StopResult): string {
  const said = result.answer ? `decided "${result.answer}"` : result.note ? clip(result.note, 600) : "finished";
  const docs = result.documents.length ? ` Documents: ${result.documents.map((doc) => `“${doc.title}” (${doc.id})`).join(", ")}.` : "";
  return `From "${name}"${result.by ? ` (${result.by})` : ""}: ${said}${docs}`;
}

/** The subtask's description, its handoff note, and for a person stop its question and context. */
function briefFor(trip: Trip, stop: PipelineStop, rows: readonly RunStop[], attempt: number, extra?: string) {
  const instructions = renderTemplate(stop.instructions, scopeOf(trip, rows));
  const preds = predecessorsOf(trip.definition).get(stop.id) ?? [];
  const previous = preds.flatMap((id) => {
    const row = rows.find((candidate) => candidate.stopId === id);
    return row?.result ? [resultLine(stopOf(trip.definition, id).name, row.result)] : [];
  });
  const where = `Stop "${stop.name}" of ${tripName(trip)}${attempt > 1 ? `, attempt ${attempt}` : ""}.`;
  const branches = stop.then.choice?.map((branch) => `"${branch.label}"`).join(", ");
  const finish =
    stop.kind === "person"
      ? ""
      : `When your part is done, complete_task this task with your result as the note (attach documents to it first); Phean hands the run on. Do not hand it on yourself.${branches ? ` Start your note with one of ${branches}: it picks the branch the run takes.` : ""}`;
  const outputs = stop.outputs.length ? `Hand on: ${stop.outputs.join("; ")}.` : "";
  const note = clip([extra, instructions, outputs, finish].filter(Boolean).join("\n\n"), 2000);
  const description = clip([extra, instructions, outputs, previous.join("\n"), where, finish].filter(Boolean).join("\n\n"), 5000);
  const question = clip(stop.instructions ? instructions.split(/\n\s*\n/)[0]! : `${stop.name}?`, 1000);
  const context = clip([extra, previous.join("\n"), where, stop.timeLimitMinutes ? `Phean waits ${stop.timeLimitMinutes} minutes${stop.onTimeout ? `, then goes with "${stop.onTimeout}"` : ""}.` : ""].filter(Boolean).join("\n\n"), 5000);
  return { description, note, question, context };
}

function minutesFrom(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

// Reaching a stop

async function reachStop(trip: Trip, stopId: string): Promise<void> {
  const stop = stopOf(trip.definition, stopId);
  const waits = stop.kind === "person" && stop.blocking;
  const [row] = await trip.sys.db
    .insert(pipelineRunStops)
    .values({ id: newId("st"), tenantId: trip.sys.tenant.id, runId: trip.run.id, stopId, state: waits ? "waiting" : "active" })
    // The current row's unique key: a stop is reached once, however many changes race to reach it.
    .onConflictDoNothing()
    .returning(stopColumns);
  if (!row) return;
  await recordEvent(trip.sys, {
    action: "pipeline.stop_reached",
    entityType: "pipeline_run",
    entityId: trip.run.id,
    summary: `reached "${stop.name}" in ${tripName(trip)}`,
    data: { ...runRef(trip), stopId },
  });
  const note = trip.notes.get(stopId);
  trip.notes.delete(stopId);
  await openStop(trip, stop, row, note);
}

/** Captures the stop's subtask and puts it in front of whoever serves the stop. */
async function openStop(trip: Trip, stop: PipelineStop, row: RunStop, extra?: string): Promise<void> {
  const { sys } = trip;
  const rows = await currentStops(sys, trip.run.id);
  const brief = briefFor(trip, stop, rows, row.attempt, extra);
  const {
    created: [task],
  } = await captureTasks(sys, {
    tasks: [{ title: row.attempt > 1 ? `${stop.name} (attempt ${row.attempt})` : stop.name, description: brief.description, status: "todo", source: "other", parentTaskId: trip.run.taskId! }],
  });
  const now = new Date();
  const waits = stop.kind === "person" && stop.blocking;
  await sys.db
    .update(pipelineRunStops)
    .set({
      taskId: task!.id,
      startedAt: now,
      dueAt: stop.timeLimitMinutes ? minutesFrom(now, stop.timeLimitMinutes) : null,
      remindAt: stop.timeLimitMinutes && waits ? minutesFrom(now, stop.timeLimitMinutes / 2) : null,
      remindedAt: null,
    })
    .where(tenantRow(sys, pipelineRunStops, row.id));
  const opened = { ...row, taskId: task!.id };
  try {
    if (stop.kind === "agent") await handOffTask(sys, { taskId: task!.id, toAgent: stop.agent!, note: brief.note });
    else if (stop.kind === "any_agent") await handOffTask(sys, { taskId: task!.id, note: brief.note });
    else if (stop.kind === "person") {
      if (stop.person) await handOffTask(sys, { taskId: task!.id, toPerson: stop.person, note: brief.note });
      if (stop.blocking) await ask(trip, stop, opened, { question: brief.question, context: brief.context, options: stop.options });
    }
  } catch (error) {
    // The agent or person is gone: the stop fails, and its failure rule says what next.
    if (!isDomainError(error)) throw error;
    await failStop(trip, opened, `Phean could not hand it over: ${error.message}`);
    return;
  }
  if (stop.kind === "person" && !stop.blocking) {
    const done = await settleRow(sys, row.id, {
      state: "done",
      endedAt: new Date(),
      dueAt: null,
      remindAt: null,
      result: { outcome: "informed", note: `Told ${await describeApprovers(sys, { person: stop.person, role: stop.role })}.`, documents: [], by: null },
    });
    if (done) await stopEvent(trip, "pipeline.stop_completed", stop, `told ${await describeApprovers(sys, { person: stop.person, role: stop.role })} at "${stop.name}"`);
  }
}

/** Asks for a decision on a stop's task as the pipeline, and marks it as the pipeline's. */
async function ask(trip: Trip, stop: PipelineStop, row: RunStop, request: { question: string; context: string; options: readonly string[] }): Promise<void> {
  const task = await requestInput(trip.sys, { taskId: row.taskId!, kind: "decision", question: request.question, context: request.context, options: [...request.options] });
  const requestId = task.inputRequest!.id;
  const ref: PipelineRequestRef = { pipelineId: trip.pipeline.id, pipelineName: trip.pipeline.name, runId: trip.run.id, runNumber: trip.run.number, stopId: stop.id, stopName: stop.name };
  await tagPipelineRequest(trip.sys, row.taskId!, requestId, ref);
  await trip.sys.db.update(pipelineRunStops).set({ requestId }).where(tenantRow(trip.sys, pipelineRunStops, row.id));
}

/** Asks again on the same task, the open request's question with `context` in front: a reminder, a tally, a nudge to pick an option. */
async function askAgain(trip: Trip, stop: PipelineStop, row: RunStop, context: string): Promise<void> {
  const task = await findTask(trip.sys, row.taskId!);
  const last = task.inputRequest ?? task.inputAnswers.find((entry) => entry.id === row.requestId);
  if (!last || !isOpenTaskStatus(task.status)) return;
  await ask(trip, stop, row, { question: last.question, context: clip(`${context}\n\n${last.context}`, 5000), options: last.options });
}

async function stopEvent(trip: Trip, action: "pipeline.stop_completed" | "pipeline.stop_failed" | "pipeline.stop_retried" | "pipeline.stop_reminded" | "pipeline.stop_timed_out", stop: PipelineStop, summary: string, data: Record<string, unknown> = {}) {
  await recordEvent(trip.sys, { action, entityType: "pipeline_run", entityId: trip.run.id, summary: `${summary} (${tripName(trip)})`, data: { ...runRef(trip), stopId: stop.id, ...data } });
}

/** Drops a stop's task if it is still open: the run has moved past it. */
async function dropTask(trip: Trip, taskId: string | null): Promise<void> {
  if (!taskId) return;
  const task = await findTask(trip.sys, taskId);
  if (isOpenTaskStatus(task.status)) await updateTask(trip.sys, { taskId, status: "dropped" });
}

// Finishing a stop

async function finishStop(trip: Trip, stop: PipelineStop, row: RunStop, result: StopResult, branch: ChoiceBranch | null): Promise<void> {
  const done = await settleRow(trip.sys, row.id, { state: "done", result, branch: branch?.label ?? null, endedAt: new Date(), requestId: null, dueAt: null, remindAt: null, reason: "" });
  if (!done) return;
  const said = result.answer ? `"${result.answer}"` : branch ? `"${branch.label}"` : "";
  await stopEvent(trip, "pipeline.stop_completed", stop, `finished "${stop.name}"${said ? ` with ${said}` : ""}`, { branch: branch?.label ?? null, outcome: result.outcome });
}

/**
 * A stop failed: its failure rule decides. `retry` hands it again with the attempt count, `hand_back`
 * runs the stop before it again with the reason, `ask` puts the choice to a person, and `fail` (or a
 * rule used up) ends this branch. The caller then advances the run.
 */
async function failStop(trip: Trip, row: RunStop, reason: string): Promise<void> {
  const stop = stopOf(trip.definition, row.stopId);
  const rule = stop.onFailure;
  if (!row.recovering) {
    if (rule.action === "retry" && row.attempt <= rule.times) {
      await retryStop(trip, stop, row, `Attempt ${row.attempt + 1} of ${rule.times + 1}. The last attempt failed: ${reason}`);
      await stopEvent(trip, "pipeline.stop_retried", stop, `retried "${stop.name}" after: ${clip(reason, 200)}`, { attempt: row.attempt + 1 });
      return;
    }
    const [before] = predecessorsOf(trip.definition).get(stop.id) ?? [];
    if (rule.action === "hand_back" && before && (await handBacks(trip, stop.id)) < rule.times) {
      await dropTask(trip, row.taskId);
      const failed = await settleRow(trip.sys, row.id, { state: "failed", reason, endedAt: new Date(), requestId: null, dueAt: null, remindAt: null });
      if (!failed) return;
      await supersede(trip, before, "hand_back");
      trip.notes.set(before, `Handed back from "${stop.name}": ${reason}`);
      await stopEvent(trip, "pipeline.stop_failed", stop, `handed "${stop.name}" back to "${stopOf(trip.definition, before).name}": ${clip(reason, 200)}`, { handedBackTo: before });
      return;
    }
    if (rule.action === "ask") {
      await recover(trip, stop, row, reason);
      return;
    }
  }
  await dropTask(trip, row.taskId);
  const failed = await settleRow(trip.sys, row.id, { state: "failed", reason, endedAt: new Date(), requestId: null, dueAt: null, remindAt: null, recovering: false });
  if (failed) await stopEvent(trip, "pipeline.stop_failed", stop, `"${stop.name}" failed: ${clip(reason, 200)}`, { reason });
}

/** How often a stop has handed back already in this run. */
async function handBacks(trip: Trip, stopId: string): Promise<number> {
  const [row] = await trip.sys.db
    .select({ n: sql<number>`count(*)::int` })
    .from(pipelineRunStops)
    .where(and(inTenant(trip.sys, pipelineRunStops), eq(pipelineRunStops.runId, trip.run.id), eq(pipelineRunStops.stopId, stopId), eq(pipelineRunStops.supersededBy, "hand_back"), eq(pipelineRunStops.state, "failed")));
  return row?.n ?? 0;
}

/** Hands a stop again, on a fresh subtask, one attempt on. */
async function retryStop(trip: Trip, stop: PipelineStop, row: RunStop, note: string): Promise<void> {
  await dropTask(trip, row.taskId);
  const waits = stop.kind === "person" && stop.blocking;
  const [next] = await trip.sys.db
    .update(pipelineRunStops)
    .set({ attempt: row.attempt + 1, state: waits ? "waiting" : "active", recovering: false, requestId: null, votes: [], reason: note, endedAt: null })
    .where(and(tenantRow(trip.sys, pipelineRunStops, row.id), inArray(pipelineRunStops.state, LIVE)))
    .returning(stopColumns);
  if (next) await openStop(trip, stop, next, note);
}

/** Failure rule `ask`: a person decides on a subtask of its own whether to retry the stop or fail the branch. */
async function recover(trip: Trip, stop: PipelineStop, row: RunStop, reason: string): Promise<void> {
  const { sys } = trip;
  await dropTask(trip, row.taskId);
  const approvers = approversOf(trip, stop, { ...row, recovering: true });
  const {
    created: [task],
  } = await captureTasks(sys, {
    tasks: [{ title: `Decide: "${stop.name}" failed`, description: clip(`"${stop.name}" in ${tripName(trip)} failed: ${reason}`, 5000), status: "todo", source: "other", parentTaskId: trip.run.taskId! }],
  });
  const [waiting] = await sys.db
    .update(pipelineRunStops)
    .set({ state: "waiting", recovering: true, taskId: task!.id, requestId: null, reason, dueAt: null, remindAt: null })
    .where(and(tenantRow(sys, pipelineRunStops, row.id), inArray(pipelineRunStops.state, LIVE)))
    .returning(stopColumns);
  if (!waiting) return;
  if (approvers.person) {
    const person = await findMember(sys, approvers.person);
    if (person) await handOffTask(sys, { taskId: task!.id, toPerson: person.id, note: `"${stop.name}" failed: ${clip(reason, 1500)}` });
  }
  await ask(trip, stop, waiting, {
    question: `"${stop.name}" failed. Retry it, or fail this branch of the run?`,
    context: clip(`${reason}\n\nStop "${stop.name}" of ${tripName(trip)}, attempt ${row.attempt}.`, 5000),
    options: RECOVERY_OPTIONS,
  });
  await stopEvent(trip, "pipeline.stop_failed", stop, `"${stop.name}" failed; asked ${await describeApprovers(sys, approvers)} whether to retry`, { reason, asking: true });
}

/** Replaces a stop's row, and every row after it, with nothing: the run reaches them again. Live ones are cancelled first. */
async function supersede(trip: Trip, fromStopId: string, by: "rerun" | "hand_back"): Promise<void> {
  const ids = [...descendantsOf(trip.definition, fromStopId)];
  const rows = (await currentStops(trip.sys, trip.run.id)).filter((row) => ids.includes(row.stopId));
  for (const row of rows) {
    if (!isLiveState(row.state)) continue;
    await dropTask(trip, row.taskId);
    await settleRow(trip.sys, row.id, { state: "cancelled", reason: by === "rerun" ? "Rerun from an earlier stop." : "Handed back to an earlier stop.", endedAt: new Date() });
  }
  if (rows.length) {
    await trip.sys.db
      .update(pipelineRunStops)
      .set({ supersededAt: new Date(), supersededBy: by })
      .where(and(inTenant(trip.sys, pipelineRunStops), inArray(pipelineRunStops.id, rows.map((row) => row.id))));
  }
}

// Moving a run on

/**
 * Works out what is next and does it, until nothing more moves: cancels the losers of a "first"
 * join, marks untaken branches skipped and stops whose inputs can never come not reached, and
 * reaches every stop whose inputs have arrived. Then rolls the run's state up, and ends it when
 * nothing can move.
 */
async function advance(trip: Trip): Promise<void> {
  const { sys } = trip;
  // A stop reached can settle at once (an advisory stop, a hand-over that failed), so plan again until stable.
  for (let pass = 0; pass < trip.definition.stops.length * 4 + 4; pass++) {
    const rows = await currentStops(sys, trip.run.id);
    const plan = planRun(trip.definition, progressOf(rows));
    if (!plan.reach.length && !plan.skip.length && !plan.notReach.length && !plan.cancel.length) break;
    for (const stopId of plan.cancel) {
      const row = rows.find((candidate) => candidate.stopId === stopId);
      if (!row) continue;
      await dropTask(trip, row.taskId);
      await settleRow(sys, row.id, { state: "cancelled", reason: "Another branch reached the join first.", endedAt: new Date(), requestId: null, dueAt: null, remindAt: null });
    }
    const settled = [
      ...plan.skip.map((stopId) => ({ stopId, state: "skipped" as const, reason: "A choice took another branch." })),
      ...plan.notReach.map((stopId) => ({ stopId, state: "not_reached" as const, reason: "What it waits on cannot arrive." })),
    ];
    if (settled.length) {
      const now = new Date();
      await sys.db
        .insert(pipelineRunStops)
        .values(settled.map((entry) => ({ id: newId("st"), tenantId: sys.tenant.id, runId: trip.run.id, ...entry, startedAt: now, endedAt: now })))
        .onConflictDoNothing();
    }
    for (const stopId of plan.reach) await reachStop(trip, stopId);
  }
  await rollRunUp(trip);
}

async function rollRunUp(trip: Trip): Promise<void> {
  const { sys, run, definition } = trip;
  const rows = await currentStops(sys, run.id);
  const status = rollUp(definition, progressOf(rows));
  if (status === "running" || status === "waiting") {
    if (status !== run.status) {
      await sys.db.update(pipelineRuns).set({ status }).where(tenantRow(sys, pipelineRuns, run.id));
      trip.run = { ...run, status };
    }
    return;
  }
  // Nothing can move: the run ends at the last end a branch reached.
  const ending = rows
    .flatMap((row) => {
      const end = endReachedBy(stopOf(definition, row.stopId), { state: row.state, branch: row.branch });
      return end ? [{ end, at: row.endedAt?.getTime() ?? 0 }] : [];
    })
    .sort((a, b) => b.at - a.at)[0]?.end;
  const endName = ending ? (definition.ends.find((end) => end.id === ending)?.name ?? ending) : null;
  const failures = rows.filter((row) => row.state === "failed");
  const summary =
    status === "done"
      ? `Ended at "${endName ?? "the end"}".`
      : `Failed at ${failures.map((row) => `"${stopOf(definition, row.stopId).name}" (${clip(row.reason, 200)})`).join(", ")}.${endName ? ` Reached "${endName}" on another branch.` : ""}`;
  const [ended] = await sys.db
    .update(pipelineRuns)
    .set({ status, endedAt: new Date(), endId: ending ?? null, endName, summary })
    .where(and(tenantRow(sys, pipelineRuns, run.id), inArray(pipelineRuns.status, [...LIVE_RUN_STATUSES])))
    .returning(runColumns);
  if (!ended) return;
  trip.run = ended;
  await recordEvent(sys, {
    action: "pipeline.run_ended",
    entityType: "pipeline_run",
    entityId: run.id,
    summary: `${status === "done" ? "finished" : "failed"} ${tripName(trip)}: ${clip(summary, 200)}`,
    data: { ...runRef(trip), status, endId: ending ?? null },
  });
  await trackRunEnd(sys, ended);
  if (run.taskId) {
    const task = await findTask(sys, run.taskId);
    if (isOpenTaskStatus(task.status)) {
      // A failed run's task waits as work for a person: rerun it, or cancel it.
      if (status === "done") await completeTask(sys, { taskId: run.taskId, note: summary });
      else if (task.status !== "todo") await updateTask(sys, { taskId: run.taskId, status: "todo" });
    }
  }
  // An ad hoc pipeline's one trip is over.
  if (status === "done" && trip.pipeline.kind === "adhoc") await setPipelineStatus(sys, trip.pipeline, "archived");
}

/** `run_end` for a run that has just ended: how, and how long it took from its start, as a bucket. */
async function trackRunEnd(ctx: Ctx, run: PipelineRun): Promise<void> {
  if (run.status !== "done" && run.status !== "failed" && run.status !== "cancelled") return;
  const duration = (run.endedAt ?? new Date()).getTime() - run.startedAt.getTime();
  await trackAfterCommit(ctx, { name: "run_end", params: { outcome: run.status, duration_bucket: durationBucket(duration) } });
}

/** Pauses, resumes or archives a pipeline, logging the change. */
export async function setPipelineStatus(ctx: Ctx, pipeline: Pipeline, status: Pipeline["status"]): Promise<Pipeline> {
  if (pipeline.status === status) return pipeline;
  const [row] = await ctx.db.update(pipelines).set({ status }).where(tenantRow(ctx, pipelines, pipeline.id)).returning(pipelineColumns);
  const action = status === "active" ? "pipeline.resumed" : status === "paused" ? "pipeline.paused" : "pipeline.archived";
  const verb = status === "active" ? "resumed" : status;
  await recordEvent(ctx, { action, entityType: "pipeline", entityId: pipeline.id, summary: `${verb} the pipeline "${pipeline.name}"`, data: { pipelineId: pipeline.id } });
  return row!;
}

// Starting a run

export interface RunStart {
  trigger: RunTrigger;
  /** Who or what started it. */
  by: { type: "user" | "agent" | "system"; id: string | null; name: string };
  detail?: string;
  scheduledFor?: Date;
  inputs?: Record<string, string | number | boolean>;
  /** Run on this existing task instead of a new one. */
  taskId?: string;
  goalId?: string;
  /** Refuse inputs the pipeline does not declare (a person or agent typed them); triggers pass only what it declares. */
  strict?: boolean;
}

function runInputs(definition: PipelineDefinition, given: Record<string, string | number | boolean>, strict: boolean): Record<string, string> {
  const declared = new Set(definition.inputs.map((input) => input.name));
  const unknown = Object.keys(given).filter((name) => !declared.has(name));
  if (strict && unknown.length) {
    throw invalid(`This pipeline takes no input named ${unknown.map((name) => `"${name}"`).join(", ")}. Its inputs: ${definition.inputs.map((input) => input.name).join(", ") || "none"}.`);
  }
  const inputs = Object.fromEntries(Object.entries(given).filter(([name]) => !strict || declared.has(name)).map(([name, value]) => [name, String(value).slice(0, 5000)]));
  const missing = definition.inputs.filter((input) => input.required && !inputs[input.name]?.trim());
  if (missing.length) throw invalid(`This pipeline needs ${missing.map((input) => `"${input.name}"${input.description ? ` (${input.description})` : ""}`).join(", ")} to start.`);
  return inputs;
}

/**
 * Starts a run of a pipeline at its current version: numbers it, gives it a task of its own (or
 * takes over `taskId`, which must not be a subtask), and moves it to its first stop. Permission is
 * the caller's to check (`startRun`); triggers call it as Phean.
 */
export async function beginRun(ctx: Ctx, pipelineId: string, start: RunStart): Promise<PipelineRun> {
  return inTransaction(ctx, async (tx) => {
    // Locked so concurrent starts number their runs one after another.
    const pipeline = await findPipeline(tx, pipelineId, { lock: true });
    if (pipeline.status !== "active") throw conflict(`"${pipeline.name}" is ${pipeline.status}, so it starts no runs.${pipeline.status === "paused" ? " Resume it first." : ""}`);
    const definition = await loadDefinition(tx, pipeline.id, pipeline.currentVersion);
    const inputs = runInputs(definition, start.inputs ?? {}, start.strict ?? false);
    const [last] = await tx.db.select({ number: max(pipelineRuns.number) }).from(pipelineRuns).where(and(inTenant(tx, pipelineRuns), eq(pipelineRuns.pipelineId, pipeline.id)));
    const number = (last?.number ?? 0) + 1;
    const sys = await pipelineContext(tx, pipeline.name);

    let taskId: string;
    if (start.taskId) {
      const task = await findTask(tx, start.taskId, { lock: true });
      if (!isOpenTaskStatus(task.status)) throw conflict(`"${task.title}" is already ${task.status}; a run needs an open task.`);
      if (task.parentTaskId) throw invalid(`"${task.title}" is a subtask, and a run's stops become subtasks of its task, which go one level deep. Start the run on "${task.parentTaskId}", or on a new task.`);
      const [taken] = await tx.db.select({ id: pipelineRuns.id }).from(pipelineRuns).where(and(inTenant(tx, pipelineRuns), eq(pipelineRuns.taskId, task.id)));
      if (taken) throw conflict(`"${task.title}" already carries run ${taken.id}. Start this one on another task.`);
      taskId = task.id;
    } else {
      const lines = Object.entries(inputs).map(([name, value]) => `- ${name}: ${clip(value, 300)}`);
      const description = clip([pipeline.description, lines.length ? `Inputs:\n${lines.join("\n")}` : ""].filter(Boolean).join("\n\n"), 5000);
      const { created } = await captureTasks(sys, { tasks: [{ title: `${pipeline.name} #${number}`, description, status: "todo", source: "other", ...(start.goalId && { goalId: start.goalId }) }] });
      taskId = created[0]!.id;
    }
    if ((await findTask(tx, taskId)).status !== "in_progress") await updateTask(sys, { taskId, status: "in_progress" });

    const [row] = await tx.db
      .insert(pipelineRuns)
      .values({
        id: newId("r"),
        tenantId: tx.tenant.id,
        pipelineId: pipeline.id,
        version: pipeline.currentVersion,
        number,
        trigger: start.trigger,
        triggeredByType: start.by.type,
        triggeredById: start.by.id,
        triggeredByName: start.by.name,
        triggerDetail: start.detail ?? "",
        scheduledFor: start.scheduledFor ?? null,
        status: "running",
        taskId,
        inputs,
      })
      .returning(runColumns);
    const run = row!;
    // The agent that started it hears how it goes, as it would for a task it captured.
    if (tx.actor.type === "agent" && !tx.actor.system) {
      await tx.db.insert(watches).values({ tenantId: tx.tenant.id, agentId: tx.actor.id, entityType: "task", entityId: taskId, reason: "auto" }).onConflictDoNothing();
    }
    await recordEvent(start.by.type === "system" ? sys : tx, {
      action: "pipeline.run_started",
      entityType: "pipeline_run",
      entityId: run.id,
      summary: `started ${pipeline.name} #${number}${start.trigger === "schedule" || start.trigger === "event" || start.trigger === "webhook" ? ` (${start.trigger})` : ""}`,
      data: { pipelineId: pipeline.id, runId: run.id, taskId, number, trigger: start.trigger },
    });
    await trackAfterCommit(tx, { name: "run_start", params: { trigger: start.trigger } });
    const trip: Trip = { run, pipeline, definition, sys, notes: new Map() };
    await advance(trip);
    return trip.run;
  });
}

// Hooks the task services call, in their transaction

/** The current, live stop row a task serves, if any. */
async function liveStopOf(ctx: Ctx, taskId: string): Promise<RunStop | null> {
  const [row] = await ctx.db
    .select(stopColumns)
    .from(pipelineRunStops)
    .where(and(inTenant(ctx, pipelineRunStops), eq(pipelineRunStops.taskId, taskId), isNull(pipelineRunStops.supersededAt), inArray(pipelineRunStops.state, LIVE)));
  return row ?? null;
}

/** What a stop handed on, from its finished task. */
async function resultOf(ctx: Ctx, taskId: string, outcome: StopResult["outcome"], note: string, extra: Partial<StopResult> = {}): Promise<StopResult> {
  return { outcome, note, documents: await documentsOf(ctx, taskId), by: ctx.actor.type === "agent" && ctx.actor.system ? null : ctx.actor.name, ...extra };
}

/**
 * A task was completed, dropped, released, or handed back (`handBack`). If it is a live stop's task,
 * the stop finishes with its result (the note, the task's documents), or fails when it was dropped or
 * let go of; then the run moves on. A run's own task dropped by someone cancels the run.
 */
export async function onTaskFinished(ctx: Ctx, task: Task, how: { kind: "completed" | "dropped" | "released" | "handed_back"; note: string }): Promise<void> {
  const found = await liveStopOf(ctx, task.id);
  if (!found) {
    if (how.kind === "dropped") {
      const [run] = await ctx.db.select({ id: pipelineRuns.id }).from(pipelineRuns).where(and(inTenant(ctx, pipelineRuns), eq(pipelineRuns.taskId, task.id), inArray(pipelineRuns.status, [...LIVE_RUN_STATUSES])));
      if (run) await endRun(ctx, run.id, `${ctx.actor.name} dropped the run's task.`);
    }
    return;
  }
  const trip = await tripOf(ctx, found.runId);
  const row = await lockStop(ctx, found.id);
  if (!row || !isLiveState(row.state) || row.taskId !== task.id) return;
  const stop = stopOf(trip.definition, row.stopId);

  if (how.kind === "handed_back") {
    // Only a hand-back to the pipeline itself finishes the stop; one to another operator is ordinary work.
    if (task.delegateToAgentId !== trip.sys.actor.id) return;
    await completeTask(trip.sys, { taskId: task.id });
  }
  if (how.kind === "dropped") await failStop(trip, row, `${ctx.actor.name} dropped its task.`);
  else if (how.kind === "released") await failStop(trip, row, `${ctx.actor.name} let it go${how.note ? `: ${how.note}` : "."}`);
  else if (row.recovering) await failStop(trip, row, "The decision on what to do was closed without an answer.");
  else {
    const result = await resultOf(ctx, task.id, how.kind === "handed_back" ? "handed_back" : "completed", how.note);
    const choice = stop.then.choice;
    const branch = choice ? (matchBranch(choice, how.note) ?? branchNamed(stop, stop.then.default ?? null) ?? null) : null;
    if (choice && !branch) await failStop(trip, row, `Its result named none of the branches (${choice.map((option) => `"${option.label}"`).join(", ")}): start the completion note with one of them.`);
    else await finishStop(trip, stop, row, result, branch);
  }
  await advance(trip);
}

/**
 * A person answered a pipeline's decision. Only someone the stop asks may answer (anyone else's
 * answer is refused, and rolls back). With several approvals needed, each answer is a vote and the
 * decision is asked again until enough people pick one option. The answer picks the branch; one that
 * names none is asked again. A failed stop's decision retries it or fails the branch.
 */
export async function onRequestAnswered(ctx: Ctx, task: Task, record: InputAnswer): Promise<void> {
  if (!record.pipeline) return;
  const found = await liveStopOf(ctx, task.id);
  if (!found || found.requestId !== record.id) return;
  const trip = await tripOf(ctx, found.runId);
  const row = await lockStop(ctx, found.id);
  if (!row || !isLiveState(row.state) || row.requestId !== record.id) return;
  const stop = stopOf(trip.definition, row.stopId);
  await assertMayDecide(ctx, approversOf(trip, stop, row), stop.name);
  // The run acts on the answer now, so nothing else collects it, and it cannot be taken back.
  await markAnswerCollected(ctx, task.id, record.id);
  const answer = record.answer.trim();

  if (row.recovering) {
    const retry = matchBranch([{ label: RECOVERY_OPTIONS[0] }], answer);
    if (retry) await retryStop(trip, stop, row, `${ctx.actor.name} chose to retry after: ${row.reason}`);
    else await failStop(trip, row, `${ctx.actor.name} chose to fail it: ${row.reason}`);
    await advance(trip);
    return;
  }

  if (!answer) {
    await askAgain(trip, stop, row, `${ctx.actor.name} marked it answered elsewhere, but the run needs the answer here.`);
    return;
  }
  let decided = answer;
  if (stop.approvals > 1) {
    const votes: StopVote[] = [...row.votes.filter((vote) => vote.userId !== ctx.actor.id), { userId: ctx.actor.id, name: ctx.actor.name, answer }];
    const tally = new Map<string, StopVote[]>();
    for (const vote of votes) {
      const key = (stop.options.find((option) => matchBranch([{ label: option }], vote.answer)) ?? vote.answer).toLowerCase();
      tally.set(key, [...(tally.get(key) ?? []), vote]);
    }
    const winner = [...tally.values()].find((group) => group.length >= stop.approvals);
    if (!winner) {
      await trip.sys.db.update(pipelineRunStops).set({ votes }).where(tenantRow(trip.sys, pipelineRunStops, row.id));
      const counts = [...tally.values()].map((group) => `"${group[0]!.answer}": ${group.map((vote) => vote.name).join(", ")}`).join("; ");
      await askAgain(trip, stop, { ...row, votes }, `${stop.approvals} people must agree. So far: ${counts}.`);
      return;
    }
    decided = winner[0]!.answer;
    await trip.sys.db.update(pipelineRunStops).set({ votes }).where(tenantRow(trip.sys, pipelineRunStops, row.id));
  }
  const choice = stop.then.choice;
  const branch = choice ? (matchBranch(choice, decided) ?? branchNamed(stop, stop.then.default ?? null) ?? null) : null;
  if (choice && !branch) {
    await askAgain(trip, stop, row, `"${clip(decided, 200)}" picks no branch of the run. Pick one of: ${choice.map((option) => `"${option.label}"`).join(", ")}.`);
    return;
  }
  const result = await resultOf(ctx, task.id, "answered", "", { answer: decided, ...(record.choices && { choices: record.choices }) });
  await completeTask(trip.sys, { taskId: task.id, note: `Decided: ${clip(decided, 500)}` });
  await finishStop(trip, stop, row, result, branch);
  await advance(trip);
}

/** Starts the runs whose event triggers match newly captured tasks (a tag, a source, or both). */
export async function onTasksCaptured(ctx: Ctx, created: readonly Task[]): Promise<void> {
  if (created.length === 0) return;
  const triggers = await ctx.db
    .select({ pipelineId: pipelineTriggers.pipelineId, tag: pipelineTriggers.tag, source: pipelineTriggers.source })
    .from(pipelineTriggers)
    .innerJoin(pipelines, and(eq(pipelines.tenantId, pipelineTriggers.tenantId), eq(pipelines.id, pipelineTriggers.pipelineId)))
    .where(and(inTenant(ctx, pipelineTriggers), eq(pipelineTriggers.kind, "event"), eq(pipelines.status, "active")));
  if (triggers.length === 0) return;
  for (const task of created) {
    const tags = new Set(task.tags.map((tag) => tag.toLowerCase()));
    const matched = new Set(triggers.filter((trigger) => (!trigger.tag || tags.has(trigger.tag.toLowerCase())) && (!trigger.source || trigger.source === task.source)).map((trigger) => trigger.pipelineId));
    for (const pipelineId of matched) {
      try {
        await beginRun(ctx, pipelineId, {
          trigger: "event",
          by: { type: ctx.actor.type, id: ctx.actor.id, name: ctx.actor.name },
          detail: `Task ${task.id} captured: ${clip(task.title, 150)}`,
          inputs: { task_id: task.id, task_title: task.title, task_description: task.description },
        });
      } catch (error) {
        // A trigger never blocks the capture that fired it.
        if (!isDomainError(error)) throw error;
        console.warn(`Pipeline ${pipelineId} did not start on task ${task.id}: ${error.message}`);
      }
    }
  }
}

// Cancelling and rerunning

/** Ends a live run as cancelled: every live stop is cancelled and its task dropped, then the run's own task. */
export async function endRun(ctx: Ctx, runId: string, reason: string): Promise<PipelineRun> {
  return inTransaction(ctx, async (tx) => {
    const trip = await tripOf(tx, runId);
    if (!(LIVE_RUN_STATUSES as readonly string[]).includes(trip.run.status)) return trip.run;
    for (const row of await currentStops(tx, runId)) {
      if (!isLiveState(row.state)) continue;
      await dropTask(trip, row.taskId);
      await settleRow(tx, row.id, { state: "cancelled", reason: "The run was cancelled.", endedAt: new Date(), requestId: null, dueAt: null, remindAt: null });
    }
    const summary = `Cancelled by ${tx.actor.name}${reason ? `: ${reason}` : "."}`;
    const [row] = await tx.db.update(pipelineRuns).set({ status: "cancelled", endedAt: new Date(), summary }).where(tenantRow(tx, pipelineRuns, runId)).returning(runColumns);
    await recordEvent(tx, {
      action: "pipeline.run_cancelled",
      entityType: "pipeline_run",
      entityId: runId,
      summary: `cancelled ${tripName(trip)}`,
      data: { ...runRef(trip), ...(reason && { reason }) },
    });
    await dropTask(trip, trip.run.taskId);
    await trackRunEnd(tx, row!);
    return row!;
  });
}

/**
 * Runs a stop again, and everything after it: its row and theirs are replaced (live ones cancelled,
 * their tasks dropped), and the stop gets a fresh subtask with `note` in its handoff. A run that had
 * ended runs again. The stop must have been reached.
 */
export async function rerunRun(ctx: Ctx, runId: string, stopId: string, note: string): Promise<PipelineRun> {
  return inTransaction(ctx, async (tx) => {
    const trip = await tripOf(tx, runId);
    if (trip.run.status === "cancelled") throw conflict(`${tripName(trip)} was cancelled. Start a new run instead.`);
    const stop = stopOf(trip.definition, stopId);
    const reached = (await currentStops(tx, runId)).find((row) => row.stopId === stopId);
    if (!reached || reached.state === "skipped" || reached.state === "not_reached") {
      throw invalid(`${tripName(trip)} has not reached "${stop.name}"${reached ? ` (it was ${reached.state.replace("_", " ")})` : ""}, so there is nothing to run again. Rerun from a stop it reached.`);
    }
    await supersede(trip, stopId, "rerun");
    trip.notes.set(stopId, `Rerun by ${tx.actor.name}${note ? `: ${note}` : "."}`);
    if (!(LIVE_RUN_STATUSES as readonly string[]).includes(trip.run.status)) {
      const [row] = await tx.db.update(pipelineRuns).set({ status: "running", endedAt: null, endId: null, endName: null, summary: "" }).where(tenantRow(tx, pipelineRuns, runId)).returning(runColumns);
      trip.run = row!;
      if (trip.run.taskId) await updateTask(trip.sys, { taskId: trip.run.taskId, status: "in_progress" });
      if (trip.pipeline.status === "archived" && trip.pipeline.kind === "adhoc") trip.pipeline = await setPipelineStatus(trip.sys, trip.pipeline, "active");
    }
    await recordEvent(tx, {
      action: "pipeline.run_rerun",
      entityType: "pipeline_run",
      entityId: runId,
      summary: `reran ${tripName(trip)} from "${stop.name}"`,
      data: { ...runRef(trip), stopId, ...(note && { note }) },
    });
    await advance(trip);
    return trip.run;
  });
}

// Time limits and schedules

export interface SweepReport {
  reminded: number;
  timedOut: number;
  started: number;
}

/** Live stops whose reminder or time limit is due at `now`. */
const dueAt = (now: Date): SQL =>
  and(
    isNull(pipelineRunStops.supersededAt),
    inArray(pipelineRunStops.state, LIVE),
    or(lte(pipelineRunStops.dueAt, now), and(lte(pipelineRunStops.remindAt, now), isNull(pipelineRunStops.remindedAt), eq(pipelineRunStops.state, "waiting"))),
  )!;

/**
 * Applies the time limits due at `now` to one stop: a person stop is reminded half way (asked again,
 * which notifies again) and, at the limit, takes its default option, or fails; an agent stop that runs
 * out of time fails, and its failure rule says what next.
 */
async function applyDeadline(ctx: Ctx, rowId: string, now: Date): Promise<"reminded" | "timedOut" | null> {
  const [found] = await ctx.db.select({ runId: pipelineRunStops.runId }).from(pipelineRunStops).where(tenantRow(ctx, pipelineRunStops, rowId));
  if (!found) return null;
  const trip = await tripOf(ctx, found.runId);
  const row = await lockStop(ctx, rowId);
  if (!row || !isLiveState(row.state)) return null;
  const stop = stopOf(trip.definition, row.stopId);
  if (row.dueAt && row.dueAt <= now) {
    const limit = `${stop.timeLimitMinutes ?? 0} minutes`;
    if (stop.kind === "person" && stop.blocking && !row.recovering && stop.onTimeout) {
      const option = stop.onTimeout;
      if (row.taskId) {
        const task = await findTask(ctx, row.taskId);
        if (task.inputRequest?.agentId === trip.sys.actor.id) await resolveInput(trip.sys, { taskId: row.taskId });
        if (isOpenTaskStatus(task.status)) await completeTask(trip.sys, { taskId: row.taskId, note: `No decision within ${limit}: went with "${option}".` });
      }
      const result = await resultOf(trip.sys, row.taskId ?? "", "timed_out", `No decision within ${limit}.`, { answer: option });
      await finishStop(trip, stop, row, result, stop.then.choice ? (branchNamed(stop, option) ?? null) : null);
      await stopEvent(trip, "pipeline.stop_timed_out", stop, `took "${option}" at "${stop.name}" when no one decided within ${limit}`, { option });
    } else {
      await stopEvent(trip, "pipeline.stop_timed_out", stop, `"${stop.name}" ran out of time (${limit})`);
      await failStop(trip, row, row.recovering ? `No one decided what to do within ${limit}.` : `It ran out of time (${limit}).`);
    }
    await advance(trip);
    return "timedOut";
  }
  if (row.state === "waiting" && row.remindAt && !row.remindedAt && row.remindAt <= now) {
    await ctx.db.update(pipelineRunStops).set({ remindedAt: now }).where(tenantRow(ctx, pipelineRunStops, row.id));
    const left = row.dueAt ? Math.max(1, Math.round((row.dueAt.getTime() - now.getTime()) / 60_000)) : null;
    await askAgain(trip, stop, row, `Reminder: the run waits on this decision${left ? `; ${left} minutes are left${stop.onTimeout ? `, then it goes with "${stop.onTimeout}"` : ""}` : ""}.`);
    await stopEvent(trip, "pipeline.stop_reminded", stop, `reminded ${await describeApprovers(ctx, approversOf(trip, stop, row))} about "${stop.name}"`);
    return "reminded";
  }
  return null;
}

/** Applies due time limits in one workspace (or one run), as a read does before it reports. */
export async function sweepDeadlines(ctx: Ctx, { runId, now = new Date() }: { runId?: string; now?: Date } = {}): Promise<Omit<SweepReport, "started">> {
  const report = { reminded: 0, timedOut: 0 };
  const due = await ctx.db
    .select({ id: pipelineRunStops.id })
    .from(pipelineRunStops)
    .where(and(inTenant(ctx, pipelineRunStops), dueAt(now), runId ? eq(pipelineRunStops.runId, runId) : undefined))
    .orderBy(asc(pipelineRunStops.dueAt))
    .limit(50);
  for (const { id } of due) {
    const outcome = await inTransaction(systemContext(ctx.db, ctx.tenant), (tx) => applyDeadline(tx, id, now));
    if (outcome === "reminded") report.reminded++;
    if (outcome === "timedOut") report.timedOut++;
  }
  return report;
}

/**
 * The cron run (`/api/pipelines/tick`): applies every workspace's due time limits, and starts the
 * runs schedules call for. A schedule starts at most one run per scheduled time (a unique key on the
 * run), and looks back only to where it last looked, so overlapping sweeps never start a time twice.
 */
export async function sweepPipelines(db: Db, now = new Date()): Promise<SweepReport> {
  const report: SweepReport = { reminded: 0, timedOut: 0, started: 0 };
  const tenantOf = { id: organization.id, slug: organization.slug, name: organization.name };
  const due = await db
    .select({ tenant: tenantOf })
    .from(pipelineRunStops)
    .innerJoin(organization, eq(organization.id, pipelineRunStops.tenantId))
    .where(dueAt(now))
    .groupBy(organization.id, organization.slug, organization.name)
    .limit(100);
  for (const { tenant } of due) {
    try {
      const swept = await sweepDeadlines(systemContext(db, tenant), { now });
      report.reminded += swept.reminded;
      report.timedOut += swept.timedOut;
    } catch (error) {
      console.error(`Pipeline deadlines failed in workspace ${tenant.slug}`, error);
    }
  }

  const schedules = await db
    .select({ id: pipelineTriggers.id, pipelineId: pipelineTriggers.pipelineId, tenant: tenantOf })
    .from(pipelineTriggers)
    .innerJoin(pipelines, and(eq(pipelines.tenantId, pipelineTriggers.tenantId), eq(pipelines.id, pipelineTriggers.pipelineId)))
    .innerJoin(organization, eq(organization.id, pipelineTriggers.tenantId))
    .where(and(eq(pipelineTriggers.kind, "schedule"), eq(pipelines.status, "active")));
  for (const schedule of schedules) {
    try {
      if (await fireSchedule(systemContext(db, schedule.tenant), schedule.id, now)) report.started++;
    } catch (error) {
      console.error(`Pipeline schedule ${schedule.id} failed`, error);
    }
  }
  return report;
}

/** Starts the run a schedule calls for at `now`, if it calls for one it has not started. */
export async function fireSchedule(ctx: Ctx, triggerId: string, now: Date): Promise<boolean> {
  return inTransaction(ctx, async (tx) => {
    // Another sweep holding it is already on it.
    const [trigger] = await tx.db.select().from(pipelineTriggers).where(tenantRow(tx, pipelineTriggers, triggerId)).for("update", { skipLocked: true });
    if (!trigger?.cron || !trigger.timeZone) return false;
    const at = latestFiring(trigger.cron, trigger.timeZone, trigger.checkedAt ?? trigger.createdAt, now);
    await tx.db.update(pipelineTriggers).set({ checkedAt: now, ...(at && { lastFiredAt: at }) }).where(tenantRow(tx, pipelineTriggers, triggerId));
    if (!at || (trigger.lastFiredAt && at <= trigger.lastFiredAt)) return false;
    try {
      await beginRun(tx, trigger.pipelineId, { trigger: "schedule", by: { type: "system", id: null, name: "Schedule" }, detail: `${trigger.cron} (${trigger.timeZone})`, scheduledFor: at });
      return true;
    } catch (error) {
      // The run for this time exists already, or the pipeline cannot start one now.
      if (isDomainError(error) || isUniqueViolation(error)) return false;
      throw error;
    }
  });
}

function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

// Reading a run

/** A stop as a run shows it: its state (`upcoming` before the run reaches it), task, result and timings. */
export interface RunStopView {
  stopId: string;
  name: string;
  kind: PipelineStop["kind"];
  state: StopState | "upcoming";
  /** Who serves it, in words: an agent's name, a person's, a role, or "any agent". */
  servedBy: string;
  attempt: number;
  task: { id: string; title: string; status: Task["status"] } | null;
  result: StopResult | null;
  branch: string | null;
  reason: string;
  /** Waiting on a decision: who it waits on. */
  waitingOn: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  dueAt: Date | null;
}

export interface RunView {
  run: PipelineRun & { task: { id: string; title: string; status: Task["status"] } | null };
  pipeline: { id: string; name: string; kind: Pipeline["kind"] };
  /** Where it stands, in words: "Waiting on Dana at Review", "At Draft", "Ended: Sent". */
  headline: string;
  /** Every stop of its definition, in the order a run meets them. */
  stops: RunStopView[];
  /** Earlier rows of stops that were rerun or handed back, newest first. */
  history: RunStopView[];
  definition: PipelineDefinition;
}

/** Who serves a stop, in words: the agent's name, the person's (or "an owner or admin"), or "any agent". */
export async function servedByOf(ctx: Ctx, stop: PipelineStop): Promise<string> {
  if (stop.kind === "agent") return stop.agent!;
  if (stop.kind === "any_agent") return "any agent";
  if (stop.kind === "person") return describeApprovers(ctx, { person: stop.person, role: stop.role });
  return "another pipeline";
}

export async function runView(ctx: Ctx, runId: string): Promise<RunView> {
  const run = await findRun(ctx, runId);
  const pipeline = await findPipeline(ctx, run.pipelineId);
  const definition = await loadDefinition(ctx, run.pipelineId, run.version);
  const rows = await ctx.db.select(stopColumns).from(pipelineRunStops).where(and(inTenant(ctx, pipelineRunStops), eq(pipelineRunStops.runId, runId))).orderBy(desc(pipelineRunStops.startedAt));
  const taskIds = [...new Set([run.taskId, ...rows.map((row) => row.taskId)].filter((id): id is string => Boolean(id)))];
  const taskRows = taskIds.length
    ? await ctx.db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks).where(and(inTenant(ctx, tasks), inArray(tasks.id, taskIds)))
    : [];
  const taskOf = (id: string | null) => taskRows.find((task) => task.id === id) ?? null;
  const trip: Trip = { run, pipeline, definition, sys: ctx, notes: new Map() };
  const servedBy = (stop: PipelineStop) => servedByOf(ctx, stop);
  const view = async (stop: PipelineStop, row: RunStop | undefined): Promise<RunStopView> => ({
    stopId: stop.id,
    name: stop.name,
    kind: stop.kind,
    state: row?.state ?? "upcoming",
    servedBy: await servedBy(stop),
    attempt: row?.attempt ?? 0,
    task: taskOf(row?.taskId ?? null),
    result: row?.result ?? null,
    branch: row?.branch ?? null,
    reason: row?.reason ?? "",
    waitingOn: row?.state === "waiting" ? await describeApprovers(ctx, approversOf(trip, stop, row)) : null,
    startedAt: row?.startedAt ?? null,
    endedAt: row?.endedAt ?? null,
    dueAt: row?.dueAt ?? null,
  });
  const current = rows.filter((row) => !row.supersededAt);
  const stops = await Promise.all(stopOrder(definition).map((id) => view(stopOf(definition, id), current.find((row) => row.stopId === id))));
  const history = await Promise.all(rows.filter((row) => row.supersededAt).map((row) => view(stopOf(definition, row.stopId), row)));
  return {
    run: { ...run, task: taskOf(run.taskId) },
    pipeline: { id: pipeline.id, name: pipeline.name, kind: pipeline.kind },
    headline: headlineOf(run, stops),
    stops,
    history,
    definition,
  };
}

/** Where a run stands, in a line: what it waits on first, then where it works, then how it ended. */
export function headlineOf(run: Pick<PipelineRun, "status" | "endName" | "summary">, stops: readonly Pick<RunStopView, "state" | "name" | "waitingOn">[]): string {
  const waiting = stops.filter((stop) => stop.state === "waiting");
  if (waiting.length) return waiting.map((stop) => `Waiting on ${stop.waitingOn ?? "a person"} at ${stop.name}`).join("; ");
  const active = stops.filter((stop) => stop.state === "active");
  if (run.status === "running" || run.status === "waiting") return active.length ? `At ${active.map((stop) => stop.name).join(", ")}` : "Moving on";
  if (run.status === "done") return `Ended: ${run.endName ?? "done"}`;
  if (run.status === "cancelled") return "Cancelled";
  return run.summary || "Failed";
}
