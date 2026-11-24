import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

import {
  PIPELINE_KINDS,
  PIPELINE_STATUSES,
  PIPELINE_TRIGGER_KINDS,
  PROPOSAL_STATES,
  RUN_STATUSES,
  RUN_TRIGGERS,
  STOP_STATES,
} from "../../../lib/domain";
import type { PipelineDefinition } from "../../../lib/pipelines";

import { organization, user } from "./auth";
import { actorTypeEnum, tasks } from "./domain";

/**
 * Pipelines (see `lib/pipelines.ts` and `domain/pipelines.ts`): a named route of stops, versioned;
 * each run rides it on a task of its own, with a subtask per stop as the run reaches it. Every table
 * is a tenant table, tied to its pipeline and run by keys that include the tenant.
 */
export const pipelineKindEnum = pgEnum("pipeline_kind", PIPELINE_KINDS);
export const pipelineStatusEnum = pgEnum("pipeline_status", PIPELINE_STATUSES);
export const proposalStateEnum = pgEnum("pipeline_proposal_state", PROPOSAL_STATES);
export const runStatusEnum = pgEnum("pipeline_run_status", RUN_STATUSES);
export const runTriggerEnum = pgEnum("pipeline_run_trigger", RUN_TRIGGERS);
export const stopStateEnum = pgEnum("pipeline_stop_state", STOP_STATES);
export const pipelineTriggerKindEnum = pgEnum("pipeline_trigger_kind", PIPELINE_TRIGGER_KINDS);

const timestampTz = (name: string) => timestamp(name, { withTimezone: true });

const tenantId = () =>
  text("tenant_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const timestamps = {
  createdAt: timestampTz("created_at").notNull().defaultNow(),
  updatedAt: timestampTz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Who made a row: a person or an agent, with the name kept as it was. */
const createdBy = {
  createdByType: actorTypeEnum("created_by_type").notNull(),
  createdById: text("created_by_id").notNull(),
  createdByName: text("created_by_name").notNull(),
};

/** Changes an agent proposed beside the definition, applied when a person approves. */
export interface ProposedSettings {
  name?: string;
  description?: string;
}

export const pipelines = pgTable(
  "pipelines",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    kind: pipelineKindEnum("kind").notNull(),
    description: text("description").notNull().default(""),
    /** The person whose call a change to a regular pipeline is (with the workspace's admins). */
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    status: pipelineStatusEnum("status").notNull().default("active"),
    /** The version new runs ride. */
    currentVersion: integer("current_version").notNull().default(1),
    /** Reserved for the factory floor that will group regular pipelines. */
    factoryId: text("factory_id"),
    ...createdBy,
    ...timestamps,
  },
  (t) => [unique("pipelines_tenant_id_uq").on(t.tenantId, t.id), index("pipelines_tenant_status_idx").on(t.tenantId, t.status)],
);

/**
 * A pipeline's definitions, numbered from 1. A version people save becomes current at once
 * (`proposalState` null); an agent's change to a regular pipeline is `proposed` until a person
 * approves (it becomes current) or rejects it.
 */
export const pipelineVersions = pgTable(
  "pipeline_versions",
  {
    tenantId: tenantId(),
    pipelineId: text("pipeline_id").notNull(),
    number: integer("number").notNull(),
    definition: jsonb("definition").$type<PipelineDefinition>().notNull(),
    ...createdBy,
    /** Why the change was made: what an agent says its proposal improves. */
    reason: text("reason").notNull().default(""),
    proposalState: proposalStateEnum("proposal_state"),
    /** The version a proposal was written against; approving it after another change is refused. */
    baseVersion: integer("base_version"),
    /** A proposal's name and description changes, if any. */
    settings: jsonb("settings").$type<ProposedSettings>(),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, { onDelete: "set null" }),
    decidedByName: text("decided_by_name"),
    decidedAt: timestampTz("decided_at"),
    /** Why a person rejected a proposal. */
    decisionNote: text("decision_note").notNull().default(""),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "pipeline_versions_pk", columns: [t.pipelineId, t.number] }),
    unique("pipeline_versions_tenant_uq").on(t.tenantId, t.pipelineId, t.number),
    foreignKey({ name: "pipeline_versions_pipeline_fk", columns: [t.tenantId, t.pipelineId], foreignColumns: [pipelines.tenantId, pipelines.id] }).onDelete("cascade"),
  ],
);

/** One trip down a pipeline, pinned to the version it started on, carried by a task of its own. */
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    pipelineId: text("pipeline_id").notNull(),
    version: integer("version").notNull(),
    /** 1, 2, 3… per pipeline. */
    number: integer("number").notNull(),
    trigger: runTriggerEnum("trigger").notNull(),
    /** Who or what started it: a person, an agent, or Phean itself (a schedule, an event, a webhook). */
    triggeredByType: text("triggered_by_type", { enum: ["user", "agent", "system"] }).notNull(),
    triggeredById: text("triggered_by_id"),
    triggeredByName: text("triggered_by_name").notNull(),
    /** What the trigger saw: the task that was captured, the scheduled time. */
    triggerDetail: text("trigger_detail").notNull().default(""),
    /** The scheduled time a schedule started it for; one run per pipeline and time. */
    scheduledFor: timestampTz("scheduled_for"),
    status: runStatusEnum("status").notNull().default("running"),
    /** The run's own task; each stop is a subtask of it. */
    taskId: text("task_id"),
    inputs: jsonb("inputs").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    startedAt: timestampTz("started_at").notNull().defaultNow(),
    endedAt: timestampTz("ended_at"),
    /** The end it reached (the definition's end id) and its name. */
    endId: text("end_id"),
    endName: text("end_name"),
    summary: text("summary").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    unique("pipeline_runs_tenant_id_uq").on(t.tenantId, t.id),
    unique("pipeline_runs_number_uq").on(t.pipelineId, t.number),
    uniqueIndex("pipeline_runs_scheduled_uq").on(t.pipelineId, t.scheduledFor).where(sql`scheduled_for is not null`),
    uniqueIndex("pipeline_runs_task_uq").on(t.tenantId, t.taskId).where(sql`task_id is not null`),
    foreignKey({ name: "pipeline_runs_pipeline_fk", columns: [t.tenantId, t.pipelineId], foreignColumns: [pipelines.tenantId, pipelines.id] }).onDelete("cascade"),
    foreignKey({
      name: "pipeline_runs_version_fk",
      columns: [t.tenantId, t.pipelineId, t.version],
      foreignColumns: [pipelineVersions.tenantId, pipelineVersions.pipelineId, pipelineVersions.number],
    }),
    foreignKey({ name: "pipeline_runs_task_fk", columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id] }),
    index("pipeline_runs_tenant_status_idx").on(t.tenantId, t.status),
    index("pipeline_runs_pipeline_idx").on(t.tenantId, t.pipelineId, t.number),
  ],
);

/** A document a stop's task carried when it finished. */
export interface StopDocument {
  id: string;
  title: string;
  format: string;
}

/** What a stop handed on: the completion or hand-back note, a person's answer, and the documents on its task. */
export interface StopResult {
  /** How it finished: its task completed, handed back, a person answered, the time ran out to the default, or a person was told (advisory). */
  outcome: "completed" | "handed_back" | "answered" | "timed_out" | "informed";
  note: string;
  answer?: string;
  choices?: string[];
  documents: StopDocument[];
  by: string | null;
}

/** One vote at a person stop that needs several approvals. */
export interface StopVote {
  userId: string;
  name: string;
  answer: string;
}

/**
 * Each stop of a run the run has reached (or decided to skip): its subtask, state, result and
 * timings. Rerunning a stop, or handing back to it, supersedes its row (and every row after it) and
 * starts a fresh one, so at most one row per stop and run is current: the unique key that makes
 * reaching a stop happen exactly once.
 */
export const pipelineRunStops = pgTable(
  "pipeline_run_stops",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    runId: text("run_id").notNull(),
    /** The stop's id in the run's definition. */
    stopId: text("stop_id").notNull(),
    /** Its subtask; null for a stop skipped or never reached. */
    taskId: text("task_id"),
    state: stopStateEnum("state").notNull(),
    /** 1, then one more on every retry. */
    attempt: integer("attempt").notNull().default(1),
    result: jsonb("result").$type<StopResult>(),
    /** The choice label its result or answer picked. */
    branch: text("branch"),
    /** The open decision at a person stop, or at a failed stop asking a person what to do. */
    requestId: text("request_id"),
    /** A failed stop asking a person whether to retry (failure rule `ask`). */
    recovering: boolean("recovering").notNull().default(false),
    votes: jsonb("votes").$type<StopVote[]>().notNull().default(sql`'[]'::jsonb`),
    /** Why it failed, was skipped, cancelled or not reached; or what its last attempt hit. */
    reason: text("reason").notNull().default(""),
    startedAt: timestampTz("started_at").notNull().defaultNow(),
    endedAt: timestampTz("ended_at"),
    /** When its time limit runs out, and when a person stop's reminder is due (half way). */
    dueAt: timestampTz("due_at"),
    remindAt: timestampTz("remind_at"),
    remindedAt: timestampTz("reminded_at"),
    /** Set when a rerun or a hand-back replaced it with a fresh row. */
    supersededAt: timestampTz("superseded_at"),
    supersededBy: text("superseded_by", { enum: ["rerun", "hand_back"] }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("pipeline_run_stops_current_uq").on(t.runId, t.stopId).where(sql`superseded_at is null`),
    foreignKey({ name: "pipeline_run_stops_run_fk", columns: [t.tenantId, t.runId], foreignColumns: [pipelineRuns.tenantId, pipelineRuns.id] }).onDelete("cascade"),
    foreignKey({ name: "pipeline_run_stops_task_fk", columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id] }),
    // Task changes find their stop; the sweep finds stops whose time is up.
    index("pipeline_run_stops_task_idx").on(t.tenantId, t.taskId),
    index("pipeline_run_stops_due_idx").on(t.dueAt).where(sql`due_at is not null and superseded_at is null`),
  ],
);

/**
 * What starts a regular pipeline's runs besides people and agents: a schedule (`cron` in
 * `timeZone`), an event (a task captured with `tag`, from `source`, or both), or an inbound webhook
 * (`secretHash`: the SHA-256 of the secret, shown once when the webhook was turned on).
 */
export const pipelineTriggers = pgTable(
  "pipeline_triggers",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    pipelineId: text("pipeline_id").notNull(),
    kind: pipelineTriggerKindEnum("kind").notNull(),
    cron: text("cron"),
    timeZone: text("time_zone"),
    tag: text("tag"),
    source: text("source"),
    secretHash: text("secret_hash"),
    /** Schedules: up to when the sweep has looked, so each scheduled time is considered once. */
    checkedAt: timestampTz("checked_at"),
    lastFiredAt: timestampTz("last_fired_at"),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "pipeline_triggers_pipeline_fk", columns: [t.tenantId, t.pipelineId], foreignColumns: [pipelines.tenantId, pipelines.id] }).onDelete("cascade"),
    index("pipeline_triggers_tenant_idx").on(t.tenantId, t.kind),
    index("pipeline_triggers_kind_idx").on(t.kind),
  ],
);

export type PipelineRow = typeof pipelines.$inferSelect;
export type PipelineVersionRow = typeof pipelineVersions.$inferSelect;
export type PipelineRunRow = typeof pipelineRuns.$inferSelect;
export type PipelineRunStopRow = typeof pipelineRunStops.$inferSelect;
export type PipelineTriggerRow = typeof pipelineTriggers.$inferSelect;
