import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
import { DOCUMENT_FORMATS } from "../../../lib/documents";
import {
  ACTOR_TYPES,
  AGENT_ACCESS_LEVELS,
  DELEGATION_STATES,
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
export const delegationEnum = pgEnum("task_delegation", DELEGATION_STATES);
export const agentAuthKindEnum = pgEnum("agent_auth_kind", ["key", "oauth"]);
export const agentAccessLevelEnum = pgEnum("agent_access_level", AGENT_ACCESS_LEVELS);
export const actorTypeEnum = pgEnum("actor_type", ACTOR_TYPES);

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
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
    /** Null for an agent that signs in with OAuth: it holds no key of its own. */
    tokenHash: text("token_hash").unique(),
    tokenPrefix: text("token_prefix"),
    /** `key`: a `phn_` token a person issued. `oauth`: it signed in through the OAuth flow and was approved. */
    authKind: agentAuthKindEnum("auth_kind").notNull().default("key"),
    accessLevel: agentAccessLevelEnum("access_level").notNull().default("write"),
    /** When an OAuth approval lapses; null for keys. */
    accessExpiresAt: timestampTz("access_expires_at"),
    oauthClientId: text("oauth_client_id"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The agent this one works for, when it is a sub-agent (one level deep). */
    parentAgentId: text("parent_agent_id"),
    /** What a sub-agent does for its parent, in a line ("Researches vendors"). */
    purpose: text("purpose").notNull().default(""),
    /**
     * A sub-agent Phean detected: it connects with its parent's token and names itself (the
     * Phean-Agent-Name header). It has no token of its own; `token_hash` holds a placeholder that
     * no real token hashes to, which also keeps one row per name under a parent.
     */
    sharesParentKey: boolean("shares_parent_key").notNull().default(false),
    createdAt: timestampTz("created_at").notNull().defaultNow(),
    lastSeenAt: timestampTz("last_seen_at"),
    revokedAt: timestampTz("revoked_at"),
    /**
     * When an OAuth agent was last renewed. An access token issued in an earlier second (its `iat`)
     * is refused, so the client a renewal replaced loses its hour-long token too. Null until renewed.
     */
    tokensNotBefore: timestampTz("tokens_not_before"),
    /** Set when a revoked agent is filed away, off the Agents list; only revoked agents are archived. */
    archivedAt: timestampTz("archived_at"),
  },
  (t) => [
    unique("agents_tenant_id_uq").on(t.tenantId, t.id),
    index("agents_tenant_idx").on(t.tenantId),
    // One live OAuth agent per person and name, so reconnecting renews instead of piling up.
    uniqueIndex("agents_oauth_name_uq")
      .on(t.tenantId, t.createdByUserId, t.name)
      .where(sql`${t.authKind} = 'oauth' and ${t.revokedAt} is null`),
    foreignKey({ name: "agents_parent_fk", columns: [t.tenantId, t.parentAgentId], foreignColumns: [t.tenantId, t.id] }),
  ],
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
    /** The workspace stage within the status, when it is not the status's own (built-in) stage. */
    stage: text("stage"),
    priority: priorityEnum("priority").notNull().default("medium"),
    source: sourceEnum("source").notNull().default("manual"),
    sourceRef: text("source_ref").notNull().default(""),
    dueDate: date("due_date", { mode: "string" }),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The agent working on it right now: its claim. A task has one operator at most, this or `operatorUserId`. */
    claimedByAgentId: text("claimed_by_agent_id"),
    /** The person working on it right now, when its operator is a person rather than an agent. */
    operatorUserId: text("operator_user_id").references(() => user.id, { onDelete: "set null" }),
    /** When its current operator took it on. */
    claimedAt: timestampTz("claimed_at"),
    /** The handover around the operator, if one is under way (`DELEGATION_STATES`). */
    delegation: delegationEnum("delegation"),
    /** Who a handoff is meant for: an agent, a person, or neither (anyone may pick it up). */
    delegateToAgentId: text("delegate_to_agent_id"),
    delegateToUserId: text("delegate_to_user_id").references(() => user.id, { onDelete: "set null" }),
    /** What the last operator said when handing it off or letting it go, for whoever picks it up. */
    delegationNote: text("delegation_note").notNull().default(""),
    /** When the delegation last changed. */
    delegatedAt: timestampTz("delegated_at"),
    completedAt: timestampTz("completed_at"),
    /** Set when a finished (done or dropped) task is filed away, off the board; reopening it clears it. */
    archivedAt: timestampTz("archived_at"),
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
    foreignKey({
      name: "tasks_delegate_to_agent_fk",
      columns: [t.tenantId, t.delegateToAgentId],
      foreignColumns: [agents.tenantId, agents.id],
    }),
    // One operator at most: an agent's claim or a person, never both.
    check("tasks_one_operator_ck", sql`num_nonnulls(${t.claimedByAgentId}, ${t.operatorUserId}) <= 1`),
    check("tasks_one_delegate_ck", sql`num_nonnulls(${t.delegateToAgentId}, ${t.delegateToUserId}) <= 1`),
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
    // The realtime stream reads a workspace's events after a cursor.
    index("events_tenant_id_idx").on(t.tenantId, t.id),
  ],
);

/**
 * Open realtime streams, one lease per WebSocket, so the caps on streams hold across server
 * instances. `rootAgentId` is the agent itself, or the agent a sub-agent works for, so sub-agent
 * names cannot multiply a token's streams. A lease is renewed as the stream runs and counts as
 * gone once it stops being renewed.
 */
export const realtimeStreams = pgTable(
  "realtime_streams",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    rootAgentId: text("root_agent_id").notNull(),
    openedAt: timestampTz("opened_at").notNull().defaultNow(),
    renewedAt: timestampTz("renewed_at").notNull().defaultNow(),
  },
  (t) => [index("realtime_streams_tenant_idx").on(t.tenantId, t.rootAgentId, t.renewedAt)],
)

/** Per-workspace settings people edit on the Settings page; one row per workspace, made on first save. */
export const workspaceSettings = pgTable("workspace_settings", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** The board's stages, in flow order (see `lib/workflow.ts`); empty means the defaults. */
  workflow: jsonb("workflow").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  ...timestamps,
});

/**
 * A person's morning digest for one workspace: emailed at `hour` in their `timeZone` once a day.
 * `lastSentAt` is also the claim that stops two cron runs sending the same morning twice.
 */
export const digestSubscriptions = pgTable(
  "digest_subscriptions",
  {
    tenantId: tenantId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 0 to 23, in `timeZone`. */
    hour: integer("hour").notNull(),
    /** An IANA zone, such as Europe/Berlin, read from the person's browser when they subscribed. */
    timeZone: text("time_zone").notNull(),
    lastSentAt: timestampTz("last_sent_at"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

/**
 * Files attached to tasks and goals: drafts, handoff notes, reports, diagrams. The row holds what
 * lists and search need; the bytes live in the blob store under `storageKey`.
 */
export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    tenantId: tenantId(),
    taskId: text("task_id"),
    goalId: text("goal_id"),
    title: text("title").notNull(),
    format: text("format", { enum: DOCUMENT_FORMATS }).notNull(),
    /** What is in it and why it matters, for agents deciding whether to fetch it. */
    summary: text("summary").notNull().default(""),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    /** Goes up by one on every edit, so an agent can tell a document changed since it read it. */
    version: integer("version").notNull().default(1),
    ...createdBy,
    updatedByName: text("updated_by_name").notNull(),
    ...timestamps,
    search: searchVector(
      "setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(summary, '')), 'B')",
    ),
  },
  (t) => [
    unique("documents_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({ name: "documents_task_fk", columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id] }).onDelete("cascade"),
    foreignKey({ name: "documents_goal_fk", columns: [t.tenantId, t.goalId], foreignColumns: [goals.tenantId, goals.id] }).onDelete("cascade"),
    index("documents_task_idx").on(t.tenantId, t.taskId),
    index("documents_goal_idx").on(t.tenantId, t.goalId),
    index("documents_search_idx").using("gin", t.search),
  ],
);

/** Document bytes when no Vercel Blob store is configured (local development, tests). */
export const documentBlobs = pgTable("document_blobs", {
  key: text("key").primaryKey(),
  tenantId: tenantId(),
  data: bytea("data").notNull(),
  createdAt: timestampTz("created_at").notNull().defaultNow(),
});

export type AgentRow = typeof agents.$inferSelect;
export type GoalRow = typeof goals.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type MemoryRow = typeof memories.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;


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
    /** Headers the endpoint requires (its own API key, say), as encrypted JSON; sent with every request. */
    headersCiphertext: text("headers_ciphertext"),
    /** Their names only, so people and the agent can see which are set without the values. */
    headerNames: text("header_names").array().notNull().default(sql`'{}'::text[]`),
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
