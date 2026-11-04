import { sql } from "drizzle-orm";
import {
  bigint,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { AgentSession, InputAnswer, InputRequest, TaskLink } from "../../../lib/agent-sessions";
import {
  ACTOR_TYPES,
  GOAL_STATUSES,
  MEMORY_KINDS,
  PRIORITIES,
  SOURCES,
  TASK_STATUSES,
  WATCHED_ENTITY_TYPES,
  WEBHOOK_TOPICS,
} from "../../../lib/domain";

import { organization, user } from "./auth";

export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const goalStatusEnum = pgEnum("goal_status", GOAL_STATUSES);
export const priorityEnum = pgEnum("priority", PRIORITIES);
export const sourceEnum = pgEnum("task_source", SOURCES);
export const memoryKindEnum = pgEnum("memory_kind", MEMORY_KINDS);
export const actorTypeEnum = pgEnum("actor_type", ACTOR_TYPES);

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

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

/** Who created a row. The name is denormalized so history survives renames and revocations. */
const createdBy = {
  createdByType: actorTypeEnum("created_by_type").notNull(),
  createdById: text("created_by_id").notNull(),
  createdByName: text("created_by_name").notNull(),
};

const searchVector = (weighted: string) =>
  tsvector("search").generatedAlwaysAs(sql.raw(weighted));

const titleDescriptionSearch =
  "setweight(to_tsvector('english', coalesce(title, '')), 'A') || " +
  "setweight(to_tsvector('english', coalesce(description, '')), 'B')";

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
    lastSeenAt: timestampTz("last_seen_at"),
    revokedAt: timestampTz("revoked_at"),
  },
  (t) => [unique("agents_tenant_id_uq").on(t.tenantId, t.id), index("agents_tenant_idx").on(t.tenantId)],
);

export const goals = pgTable(
  "goals",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    parentId: text("parent_id"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: goalStatusEnum("status").notNull().default("proposed"),
    approvedById: text("approved_by_id"),
    approvedByName: text("approved_by_name"),
    approvedAt: timestampTz("approved_at"),
    ...createdBy,
    ...timestamps,
    search: searchVector(titleDescriptionSearch),
  },
  (t) => [
    unique("goals_tenant_id_uq").on(t.tenantId, t.id),
    // Composite FK keeps every parent inside the same tenant.
    foreignKey({
      name: "goals_parent_fk",
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }),
    index("goals_tenant_status_idx").on(t.tenantId, t.status),
    index("goals_parent_idx").on(t.tenantId, t.parentId),
    index("goals_search_idx").using("gin", t.search),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    goalId: text("goal_id"),
    /** The task this one is a step of. One level only: a subtask has no subtasks of its own. */
    parentTaskId: text("parent_task_id"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: taskStatusEnum("status").notNull().default("inbox"),
    priority: priorityEnum("priority").notNull().default("medium"),
    source: sourceEnum("source").notNull().default("manual"),
    sourceRef: text("source_ref").notNull().default(""),
    dueDate: date("due_date", { mode: "string" }),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    claimedByAgentId: text("claimed_by_agent_id"),
    claimedAt: timestampTz("claimed_at"),
    completedAt: timestampTz("completed_at"),
    /** Where people can resume the work with each agent, newest first. */
    agentSessions: jsonb("agent_sessions")
      .$type<AgentSession[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The question an agent is waiting on a person to answer, if any. */
    inputRequest: jsonb("input_request").$type<InputRequest>(),
    /** Closed questions and decisions, newest first, with each person's answer. */
    inputAnswers: jsonb("input_answers")
      .$type<InputAnswer[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** References agents left for people: the conversation, the source message, docs. */
    links: jsonb("links")
      .$type<TaskLink[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...createdBy,
    ...timestamps,
    search: searchVector(titleDescriptionSearch),
  },
  (t) => [
    unique("tasks_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({
      name: "tasks_goal_fk",
      columns: [t.tenantId, t.goalId],
      foreignColumns: [goals.tenantId, goals.id],
    }),
    foreignKey({
      name: "tasks_parent_fk",
      columns: [t.tenantId, t.parentTaskId],
      foreignColumns: [t.tenantId, t.id],
    }),
    foreignKey({
      name: "tasks_claimed_by_fk",
      columns: [t.tenantId, t.claimedByAgentId],
      foreignColumns: [agents.tenantId, agents.id],
    }),
    // Several agents scanning the same inbox must not capture the same item twice.
    uniqueIndex("tasks_source_ref_uq")
      .on(t.tenantId, t.source, t.sourceRef)
      .where(sql`source_ref <> ''`),
    index("tasks_tenant_status_idx").on(t.tenantId, t.status),
    index("tasks_tenant_goal_idx").on(t.tenantId, t.goalId),
    index("tasks_tenant_parent_idx").on(t.tenantId, t.parentTaskId),
    index("tasks_search_idx").using("gin", t.search),
  ],
);

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    kind: memoryKindEnum("kind").notNull().default("note"),
    content: text("content").notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    goalId: text("goal_id"),
    taskId: text("task_id"),
    ...createdBy,
    ...timestamps,
    search: searchVector("to_tsvector('english', coalesce(content, ''))"),
  },
  (t) => [
    foreignKey({
      name: "memories_goal_fk",
      columns: [t.tenantId, t.goalId],
      foreignColumns: [goals.tenantId, goals.id],
    }),
    foreignKey({
      name: "memories_task_fk",
      columns: [t.tenantId, t.taskId],
      foreignColumns: [tasks.tenantId, tasks.id],
    }),
    index("memories_tenant_kind_idx").on(t.tenantId, t.kind),
    index("memories_search_idx").using("gin", t.search),
  ],
);

export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: tenantId(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("events_tenant_created_idx").on(t.tenantId, t.createdAt.desc()),
    index("events_tenant_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  ],
);

export type AgentRow = typeof agents.$inferSelect;
export type GoalRow = typeof goals.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type EventRow = typeof events.$inferSelect;


/**
 * The objects each agent follows. Phean adds a watch whenever an agent acts on a task, goal or
 * memory (it captured, claimed, asked about, updated, created or saved it); agents can also add
 * and remove watches themselves. Webhook routing reads this table.
 */
export const watches = pgTable(
  "watches",
  {
    tenantId: tenantId(),
    agentId: text("agent_id").notNull(),
    entityType: text("entity_type", { enum: WATCHED_ENTITY_TYPES }).notNull(),
    entityId: text("entity_id").notNull(),
    /** Why the agent follows it: "auto" (it acted on it) or "manual" (it asked to). */
    reason: text("reason", { enum: ["auto", "manual"] }).notNull(),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "watches_pk", columns: [t.agentId, t.entityType, t.entityId] }),
    foreignKey({
      name: "watches_agent_fk",
      columns: [t.tenantId, t.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
    // Routing looks watchers up by the object an event is about.
    index("watches_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  ],
);


/** One endpoint per agent, registered by the agent, called when something it follows changes. */
export const webhooks = pgTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    agentId: text("agent_id").notNull(),
    url: text("url").notNull(),
    /** The signing secret, encrypted with the server's webhook key (AES-256-GCM). */
    secretCiphertext: text("secret_ciphertext").notNull(),
    topics: text("topics", { enum: WEBHOOK_TOPICS }).array().notNull(),
    /** "related": what the agent follows. "all": every change in the workspace, within the topics. */
    scope: text("scope", { enum: ["related", "all"] }).notNull().default("related"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    disabledReason: text("disabled_reason"),
    /** Failed sends in a row; resets on success. Drives backoff and disabling. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /** Earliest time the dispatcher may send again (backoff after a failure). */
    nextAttemptAt: timestampTz("next_attempt_at").notNull().defaultNow(),
    /** Held by the dispatcher sending to this webhook, so sends stay one at a time and in order. */
    leaseUntil: timestampTz("lease_until"),
    lastSuccessAt: timestampTz("last_success_at"),
    lastFailureAt: timestampTz("last_failure_at"),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    unique("webhooks_agent_uq").on(t.agentId),
    foreignKey({
      name: "webhooks_agent_fk",
      columns: [t.tenantId, t.agentId],
      foreignColumns: [agents.tenantId, agents.id],
    }).onDelete("cascade"),
    index("webhooks_tenant_idx").on(t.tenantId, t.status),
  ],
);

/**
 * The outbox: one row per (webhook, event), written in the same transaction as the event, so a
 * committed change always has its notifications and a rolled-back one never does.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: tenantId(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    /** Why this agent gets the event, e.g. "watching:task", "asked_by_you". */
    reasons: text("reasons").array().notNull(),
    status: text("status", { enum: ["pending", "delivered", "dead"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
    deliveredAt: timestampTz("delivered_at"),
  },
  (t) => [
    unique("webhook_deliveries_event_uq").on(t.webhookId, t.eventId),
    // The dispatcher reads a webhook's pending deliveries oldest first.
    index("webhook_deliveries_pending_idx").on(t.webhookId, t.status, t.id),
  ],
);

export type WatchRow = typeof watches.$inferSelect;
export type WebhookRow = typeof webhooks.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
