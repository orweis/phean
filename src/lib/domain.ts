/**
 * Single source of truth for Phean's domain vocabulary. Used by the database
 * enums, the zod input schemas, and the UI, so it must stay client-safe.
 */
import type { LinkKind, RequestKind, RequestOutcome } from "./agent-sessions";
import { isPastDue } from "./dates";
import { roleCan } from "./permissions";

/** Narrows an untrusted value (a query parameter, a logged event field) to one of `values`. */
export function isOneOf<V extends string | number>(values: readonly V[], value: unknown): value is V {
  return (values as readonly unknown[]).includes(value);
}

/** A tally of zero for each value, to fill in values a grouped count did not return. */
export function zeroCounts<V extends string>(values: readonly V[]): Record<V, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<V, number>;
}

/**
 * Where a task stands. Backlog is work accepted but not planned yet: open, but parked between the
 * inbox and to do. A workspace's own stages (lanes) each belong to one of these.
 */
export const TASK_STATUSES = ["inbox", "backlog", "todo", "in_progress", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_TASK_STATUSES = ["inbox", "backlog", "todo", "in_progress"] as const satisfies readonly TaskStatus[];
/** The stations a task passes through, in board and chart order; "dropped" is an end, not a station. */
export const STATIONS = ["inbox", "backlog", "todo", "in_progress", "done"] as const satisfies readonly TaskStatus[];
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

/** How much an agent may do: read the workspace, contribute to it, or also manage other agents. */
export const AGENT_ACCESS_LEVELS = ["read", "write", "admin"] as const;
export type AgentAccessLevel = (typeof AGENT_ACCESS_LEVELS)[number];

/** How long an agent's approval lasts, in days. There is no "never". */
export const AGENT_LIFETIME_DAYS = [1, 7, 30, 90, 365] as const;
export const DEFAULT_AGENT_LIFETIME_DAYS = 30;

/** What the dialog calls a lifetime. */
export function lifetimeLabel(days: number): string {
  if (days === 365) return "1 year";
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * The levels a person of this role may grant: Admin only with `agent:manage` in the policy matrix,
 * since an Admin agent holds it; any other role, present or future, stops at Write.
 */
export function grantableLevels(role: string): readonly AgentAccessLevel[] {
  return roleCan(role, "agent:manage") ? AGENT_ACCESS_LEVELS : ["read", "write"];
}

/** The highest level a person of this role may grant. */
export function highestGrantableLevel(role: MemberRole): AgentAccessLevel {
  const levels = grantableLevels(role);
  return levels[levels.length - 1]!;
}

/** The lower of two levels. */
export function lowerLevel(a: AgentAccessLevel, b: AgentAccessLevel): AgentAccessLevel {
  return AGENT_ACCESS_LEVELS.indexOf(a) <= AGENT_ACCESS_LEVELS.indexOf(b) ? a : b;
}

/** Better Auth stores roles as a comma-separated list (or none); Phean uses the most privileged one. */
export function toMemberRole(raw: string | null): MemberRole {
  const roles = (raw ?? "").split(",").map((role) => role.trim());
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}

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
  headerValue: 2000,
  linkTitle: 120,
  stageLabel: 40,
  documentTitle: 200,
  documentSummary: 500,
  /** Characters of a text document. */
  documentText: 500_000,
  /** Bytes of a binary document (a PDF, an image), before base64. */
  documentBytes: 5_000_000,
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

/** `fresh` is the inbox's sky; `warning` is the ember of what waits on a person; `accent` the ember badge. */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent" | "fresh";

interface EnumMeta {
  label: string;
  tone: Tone;
}

export const TASK_STATUS_META: Record<TaskStatus, EnumMeta> = {
  inbox: { label: "Inbox", tone: "fresh" },
  backlog: { label: "Backlog", tone: "neutral" },
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

/**
 * Kinds are categories, not states, so they stay neutral; facts, the kind agents lean on most, take
 * the info tint. "decision" reads as "Choice", so "decision" on screen always means an agent's request.
 */
export const MEMORY_KIND_META: Record<MemoryKind, EnumMeta> = {
  fact: { label: "Fact", tone: "info" },
  preference: { label: "Preference", tone: "neutral" },
  decision: { label: "Choice", tone: "neutral" },
  context: { label: "Context", tone: "neutral" },
  note: { label: "Note", tone: "neutral" },
};

export const ACCESS_LEVEL_META: Record<AgentAccessLevel, EnumMeta> = {
  read: { label: "Read", tone: "neutral" },
  write: { label: "Write", tone: "info" },
  admin: { label: "Admin", tone: "warning" },
};

/** Matches the window the workspace stats use for "active agents". */
const ACTIVE_AGENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AgentStatus = "active" | "idle" | "expired" | "approver_left" | "revoked";

export const AGENT_STATUS_META: Record<AgentStatus, EnumMeta> = {
  active: { label: "Active", tone: "success" },
  idle: { label: "Idle", tone: "neutral" },
  // Amber, not red: an expired agent is waiting for someone to approve it again, not cut off for cause.
  expired: { label: "Expired", tone: "warning" },
  // Amber too: it resumes if its approver returns, or someone else connects it again.
  approver_left: { label: "Approver left", tone: "warning" },
  revoked: { label: "Revoked", tone: "danger" },
};

/**
 * Where an agent stands: revoked, past the end of its access, unable to act for another reason (its
 * approver, or its parent's, left the workspace), or active or idle by when it was last seen. For a
 * sub-agent, pass its access end from `agentAccessEnds`, so it lapses with its parent, and `live`
 * from the server's standing, so this never second-guesses what a request would be told.
 */
export function agentStatus(
  agent: { revokedAt: Date | null; lastSeenAt: Date | null; accessExpiresAt: Date | null; live?: boolean },
  now = Date.now(),
): AgentStatus {
  if (agent.revokedAt) return "revoked";
  if (agent.accessExpiresAt && agent.accessExpiresAt.getTime() <= now) return "expired";
  if (agent.live === false) return "approver_left";
  return agent.lastSeenAt && now - agent.lastSeenAt.getTime() < ACTIVE_AGENT_WINDOW_MS ? "active" : "idle";
}

/** When an agent's access ends: its own end, or its parent's if that comes first. Null for a key that does not lapse. */
export function agentAccessEnds(agent: { accessExpiresAt: Date | null }, parent?: { accessExpiresAt: Date | null }): Date | null {
  const ends = [agent.accessExpiresAt, parent?.accessExpiresAt].filter((date): date is Date => !!date);
  return ends.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

/** How an agent reaches Phean: signed in through the browser, with a fixed key, or naming itself on its parent's key. */
export type AgentConnection = "oauth" | "key" | "shared_key";

export const AGENT_CONNECTION_META: Record<AgentConnection, EnumMeta> = {
  oauth: { label: "OAuth sign-in", tone: "accent" },
  key: { label: "Fixed key", tone: "neutral" },
  shared_key: { label: "Shared key", tone: "neutral" },
};

export function agentConnection(agent: { authKind: "key" | "oauth"; sharesParentKey: boolean }): AgentConnection {
  return agent.sharesParentKey ? "shared_key" : agent.authKind;
}

export const ROLE_META: Record<MemberRole | "platform_admin", EnumMeta> = {
  owner: { label: "Owner", tone: "info" },
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
