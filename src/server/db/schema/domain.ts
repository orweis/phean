import { sql } from "drizzle-orm";
import {
  bigint,
  customType,
  date,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  ACTOR_TYPES,
  GOAL_STATUSES,
  MEMORY_KINDS,
  PRIORITIES,
  SOURCES,
  TASK_STATUSES,
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
