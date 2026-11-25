import { sql } from "drizzle-orm";
import { bigint, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth";

const timestampTz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Every look at the backoffice: who, what, when, with which filters, and why when it showed customer
 * content. Written by `platformService` for each call, so every page view and export is a row. Not a
 * tenant table: `tenant_id` names the workspace an entry was about, and outlives it (no foreign key).
 */
export const backofficeAudit = pgTable(
  "backoffice_audit",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestampTz("at").notNull().defaultNow(),
    adminUserId: text("admin_user_id").notNull(),
    /** Kept as it was, so the trail survives the person's account. */
    adminEmail: text("admin_email").notNull(),
    /** `view.overview`, `export.workspaces`, `content.reveal`, … */
    action: text("action").notNull(),
    tenantId: text("tenant_id"),
    /** A person the admin looked up. */
    subjectUserId: text("subject_user_id"),
    /** The service's parsed input: search words, sort, page. */
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    /** Why the admin showed a workspace's content. */
    reason: text("reason"),
  },
  (t) => [
    index("backoffice_audit_at_idx").on(t.at.desc()),
    // Whether an admin showed a workspace's content recently.
    index("backoffice_audit_grant_idx").on(t.adminUserId, t.tenantId, t.action, t.at),
  ],
);

/**
 * Events per UTC day, workspace, actor and action, rolled up from `events` by `rollUpUsage`, so the
 * backoffice reads trends, active counts and adoption without scanning the log. `actor_type` is
 * `user`, `agent`, or `system` (the pipelines agent). `task.done` is synthetic: completions plus
 * updates to done.
 */
export const usageDaily = pgTable(
  "usage_daily",
  {
    day: date("day", { mode: "string" }).notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    actorType: text("actor_type", { enum: ["user", "agent", "system"] }).notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    events: integer("events").notNull(),
  },
  (t) => [
    primaryKey({ name: "usage_daily_pk", columns: [t.day, t.tenantId, t.actorType, t.actorId, t.action] }),
    index("usage_daily_action_idx").on(t.action, t.day),
  ],
);

/** MCP tool calls per UTC day, workspace, agent and tool, counted as they happen; never the input or the result. */
export const toolCallsDaily = pgTable(
  "tool_calls_daily",
  {
    day: date("day", { mode: "string" }).notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    tool: text("tool").notNull(),
    calls: integer("calls").notNull().default(0),
    errors: integer("errors").notNull().default(0),
  },
  (t) => [primaryKey({ name: "tool_calls_daily_pk", columns: [t.day, t.tenantId, t.agentId, t.tool] }), index("tool_calls_daily_day_idx").on(t.day)],
);

/** When `rollUpUsage` last finished, and through which day; one row. */
export const usageRollupState = pgTable("usage_rollup_state", {
  id: text("id").primaryKey().default(sql`'usage'`),
  /** The last whole day rolled up (today is always recomputed). */
  throughDay: date("through_day", { mode: "string" }),
  ranAt: timestampTz("ran_at").notNull().defaultNow(),
});

/**
 * Every workspace deleted, written in the deletion's own transaction before any of its rows go: who
 * deleted which workspace, and how much went with it. Phean's own record, like `backoffice_audit`:
 * `tenant_id` names the workspace and outlives it (no foreign key), and it holds metadata only (the
 * name, slug and counts, never a task, decision or document). Append-only: nothing in the app
 * updates a row except `blobs_cleared_at`, set once the workspace's files are gone from the blob store.
 */
export const workspaceDeletions = pgTable(
  "workspace_deletions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestampTz("at").notNull().defaultNow(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Kept as they were, so the record survives the person's account. */
    deletedByUserId: text("deleted_by_user_id").notNull(),
    deletedByEmail: text("deleted_by_email").notNull(),
    deletedByName: text("deleted_by_name").notNull(),
    /** What went with it: tasks, goals, decisions, documents, memories, agents, pipelines, webhooks, members. */
    counts: jsonb("counts").$type<Record<string, number>>().notNull(),
    /**
     * When its document files were deleted from the blob store, which is outside the database: at once
     * where the bytes live in Postgres, otherwise after commit, retried by the pipelines tick.
     */
    blobsClearedAt: timestampTz("blobs_cleared_at"),
  },
  (t) => [index("workspace_deletions_at_idx").on(t.at.desc())],
);

export type BackofficeAuditRow = typeof backofficeAudit.$inferSelect;
export type WorkspaceDeletionRow = typeof workspaceDeletions.$inferSelect;
