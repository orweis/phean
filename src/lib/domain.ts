/**
 * Single source of truth for Phean's domain vocabulary. Used by the database
 * enums, the zod input schemas, and the UI, so it must stay client-safe.
 */
import type { LinkKind, RequestKind, RequestOutcome } from "./agent-sessions";
import { isPastDue } from "./dates";

/** Narrows an untrusted value (a query parameter, a logged event field) to one of `values`. */
export function isOneOf<V extends string | number>(values: readonly V[], value: unknown): value is V {
  return (values as readonly unknown[]).includes(value);
}

/** A tally of zero for each value, to fill in values a grouped count did not return. */
export function zeroCounts<V extends string>(values: readonly V[]): Record<V, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<V, number>;
}

export const TASK_STATUSES = ["inbox", "todo", "in_progress", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_TASK_STATUSES = ["inbox", "todo", "in_progress"] as const satisfies readonly TaskStatus[];
/** The stations a task passes through, in board and chart order; "dropped" is an end, not a station. */
export const STATIONS = ["inbox", "todo", "in_progress", "done"] as const satisfies readonly TaskStatus[];
export type Station = (typeof STATIONS)[number];

export const GOAL_STATUSES = ["proposed", "active", "achieved", "abandoned"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SOURCES = ["email", "slack", "calendar", "chat", "manual", "other"] as const;
export type Source = (typeof SOURCES)[number];

export const MEMORY_KINDS = ["fact", "preference", "decision", "context", "note"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const ACTOR_TYPES = ["user", "agent"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const INVITABLE_ROLES = ["member", "admin"] as const satisfies readonly MemberRole[];

/** What a watch, and so a webhook delivery, can be about. */
export const WATCHED_ENTITY_TYPES = ["task", "goal", "memory"] as const;
export type WatchedEntityType = (typeof WATCHED_ENTITY_TYPES)[number];

/** What a webhook can subscribe to; an event can belong to more than one. */
export const WEBHOOK_TOPICS = ["decisions", "tasks", "goals", "memory"] as const;
export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];

export const GOAL_MAX_DEPTH = 4;
export const AGENT_TOKEN_PREFIX = "phn_";

/** Longest accepted values, shared by the input schemas and the forms' `maxLength`. */
export const LIMITS = {
  title: 200,
  text: 5000,
  memory: 4000,
  note: 2000,
  name: 80,
  query: 200,
  tag: 40,
  sourceRef: 500,
  slug: 40,
  url: 2000,
  ref: 200,
  command: 500,
  brief: 500,
  question: 1000,
  option: 200,
  linkTitle: 120,
} as const;

/**
 * A workspace's URL slug, as a pattern source rather than a RegExp so forms can use it too: the
 * escaped hyphen keeps it valid under the `v` flag browsers apply to the HTML `pattern` attribute.
 */
export const WORKSPACE_SLUG_PATTERN = `[a-z0-9](?:[a-z0-9\\-]{0,${LIMITS.slug - 2}}[a-z0-9])?`;

/** A slug suggestion for a workspace name: "Acme Corp." becomes "acme-corp", "Café Zürich" "cafe-zurich". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.slug)
    .replace(/-+$/, "");
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

interface EnumMeta {
  label: string;
  tone: Tone;
}

export const TASK_STATUS_META: Record<TaskStatus, EnumMeta> = {
  inbox: { label: "Inbox", tone: "accent" },
  todo: { label: "To do", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "success" },
  dropped: { label: "Dropped", tone: "neutral" },
};

export const GOAL_STATUS_META: Record<GoalStatus, EnumMeta> = {
  proposed: { label: "Proposed", tone: "warning" },
  active: { label: "Active", tone: "info" },
  achieved: { label: "Achieved", tone: "success" },
  abandoned: { label: "Abandoned", tone: "neutral" },
};

export const PRIORITY_META: Record<Priority, EnumMeta> = {
  urgent: { label: "Urgent", tone: "danger" },
  high: { label: "High", tone: "warning" },
  medium: { label: "Medium", tone: "neutral" },
  low: { label: "Low", tone: "neutral" },
};

export const SOURCE_META: Record<Source, EnumMeta> = {
  email: { label: "Email", tone: "neutral" },
  slack: { label: "Slack", tone: "neutral" },
  calendar: { label: "Calendar", tone: "neutral" },
  chat: { label: "Chat", tone: "neutral" },
  manual: { label: "Manual", tone: "neutral" },
  other: { label: "Other", tone: "neutral" },
};

export const REQUEST_KIND_META: Record<RequestKind, EnumMeta> = {
  question: { label: "Question", tone: "neutral" },
  decision: { label: "Decision", tone: "warning" },
};

export const REQUEST_OUTCOME_META: Record<RequestOutcome, EnumMeta> = {
  answered: { label: "Answered", tone: "success" },
  answered_elsewhere: { label: "Answered elsewhere", tone: "success" },
  resolved: { label: "Resolved by the agent", tone: "neutral" },
  closed: { label: "Closed with the task", tone: "neutral" },
};

export const WEBHOOK_STATES = ["active", "failing", "disabled"] as const;
export type WebhookState = (typeof WEBHOOK_STATES)[number];

export const WEBHOOK_STATE_META: Record<WebhookState, EnumMeta> = {
  active: { label: "Delivering", tone: "success" },
  failing: { label: "Retrying", tone: "warning" },
  disabled: { label: "Disabled", tone: "danger" },
};

/** How a webhook is doing, from its status and its run of failures. */
export function webhookState(webhook: { status: "active" | "disabled"; consecutiveFailures: number }): WebhookState {
  if (webhook.status === "disabled") return "disabled";
  return webhook.consecutiveFailures > 0 ? "failing" : "active";
}

export const LINK_KIND_META: Record<LinkKind, EnumMeta> = {
  conversation: { label: "Conversation", tone: "accent" },
  source: { label: "Source", tone: "neutral" },
  doc: { label: "Doc", tone: "neutral" },
  other: { label: "Link", tone: "neutral" },
};

export const MEMORY_KIND_META: Record<MemoryKind, EnumMeta> = {
  fact: { label: "Fact", tone: "info" },
  preference: { label: "Preference", tone: "accent" },
  decision: { label: "Decision", tone: "success" },
  context: { label: "Context", tone: "neutral" },
  note: { label: "Note", tone: "neutral" },
};

export const ROLE_META: Record<MemberRole | "platform_admin", EnumMeta> = {
  owner: { label: "Owner", tone: "accent" },
  admin: { label: "Admin", tone: "info" },
  member: { label: "Member", tone: "neutral" },
  platform_admin: { label: "Read-only", tone: "warning" },
};

export function isOpenTaskStatus(status: TaskStatus): boolean {
  return isOneOf(OPEN_TASK_STATUSES, status);
}

/** Still open after its due day has ended (in UTC, like the database's overdue filter). */
export function isLate(task: { status: TaskStatus; dueDate: string | null }, now = new Date()): boolean {
  return isOpenTaskStatus(task.status) && isPastDue(task.dueDate, now);
}
