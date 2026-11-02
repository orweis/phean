/**
 * Single source of truth for Phean's domain vocabulary. Used by the database
 * enums, the zod input schemas, and the UI, so it must stay client-safe.
 */

export const TASK_STATUSES = ["inbox", "todo", "in_progress", "done", "dropped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_TASK_STATUSES = ["inbox", "todo", "in_progress"] as const satisfies readonly TaskStatus[];
export const BOARD_COLUMNS = ["inbox", "todo", "in_progress", "done"] as const satisfies readonly TaskStatus[];

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

export const GOAL_MAX_DEPTH = 4;
export const AGENT_TOKEN_PREFIX = "phn_";

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
  return (OPEN_TASK_STATUSES as readonly TaskStatus[]).includes(status);
}
