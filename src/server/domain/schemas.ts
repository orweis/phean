import { z } from "zod";

import {
  GOAL_STATUSES,
  MEMORY_KINDS,
  PRIORITIES,
  SOURCES,
  TASK_STATUSES,
} from "@/lib/domain";
import { TIMELINE_WINDOWS } from "@/lib/timeline";

const goalId = z.string().trim().min(1).describe("Goal id (g_...)");
const taskId = z.string().trim().min(1).describe("Task id (t_...)");
const title = z.string().trim().min(1).max(200);
const longText = z.string().trim().max(5000);
const isoDate = z.iso.date().describe("Date as YYYY-MM-DD");
const tags = z.array(z.string().trim().min(1).max(40)).max(20);
const limit = (max: number, fallback: number) => z.number().int().min(1).max(max).default(fallback);

export const Empty = z.object({});

// Goals
export const CreateGoalInput = z.object({
  title,
  description: longText.default(""),
  parentGoalId: goalId.optional().describe("Make this a sub-goal of an existing goal"),
});

export const UpdateGoalInput = z.object({
  goalId,
  title: title.optional(),
  description: longText.optional(),
  parentGoalId: goalId.nullable().optional().describe("Move under another goal, or null to make it top-level"),
});

export const SetGoalStatusInput = z.object({ goalId, status: z.enum(GOAL_STATUSES) });
export const ListGoalsInput = z.object({ status: z.enum(GOAL_STATUSES).optional() });
export const GoalRefInput = z.object({ goalId });

// Tasks
export const TaskDraft = z.object({
  title,
  description: longText.default(""),
  source: z.enum(SOURCES).default("manual"),
  sourceRef: z
    .string()
    .trim()
    .max(500)
    .default("")
    .describe("Stable origin reference (message link, thread id, event id). Used to skip duplicates."),
  dueDate: isoDate.optional(),
  priority: z.enum(PRIORITIES).default("medium"),
  goalId: goalId.optional(),
  tags: tags.default([]),
  status: z.enum(["inbox", "todo"]).default("inbox"),
});

export const CaptureTasksInput = z.object({ tasks: z.array(TaskDraft).min(1).max(100) });

export const UpdateTaskInput = z.object({
  taskId,
  title: title.optional(),
  description: longText.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: isoDate.nullable().optional(),
  goalId: goalId.nullable().optional(),
  tags: tags.optional(),
});

export const TaskRefInput = z.object({ taskId });
export const CompleteTaskInput = z.object({
  taskId,
  note: z.string().trim().max(2000).default("").describe("What was done, in one or two sentences"),
});
export const AssignTasksInput = z.object({ taskIds: z.array(taskId).min(1).max(100), goalId });

export const ListTasksInput = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  goalId: goalId.optional(),
  priority: z.enum(PRIORITIES).optional(),
  claimed: z.enum(["any", "mine", "unclaimed"]).default("any"),
  due: z
    .enum(["any", "overdue", "next_7_days"])
    .default("any")
    .describe("Filter open tasks by due date (overdue = past due and not done)"),
  limit: limit(200, 50),
});

export const NextActionsInput = z.object({ limit: limit(20, 5) });
export const GoalScopeInput = z.object({
  goalId: goalId.optional().describe("Only this goal and its sub-goals"),
});
export const BoardInput = GoalScopeInput.extend({ doneLimit: limit(100, 20) });
export const JourneysInput = GoalScopeInput.extend({
  days: z
    .literal(TIMELINE_WINDOWS)
    .default(14)
    .describe("How many days of history to replay, ending today"),
});

// Memory
export const RememberInput = z.object({
  content: z.string().trim().min(1).max(4000),
  kind: z.enum(MEMORY_KINDS).default("note"),
  tags: tags.default([]),
  goalId: goalId.optional(),
  taskId: taskId.optional(),
});

export const RecallInput = z.object({
  query: z.string().trim().max(200).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  goalId: goalId.optional(),
  limit: limit(100, 20),
});

export const MemoryRefInput = z.object({ memoryId: z.string().trim().min(1) });

// Search, activity, views
export const SEARCH_KINDS = ["goal", "task", "memory"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SearchInput = z.object({
  query: z.string().trim().min(1).max(200),
  kinds: z.array(z.enum(SEARCH_KINDS)).min(1).optional(),
  limit: limit(50, 20),
});

export const ActivityInput = z.object({
  since: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("Only events at or after this ISO timestamp (pass the newest createdAt you have seen)"),
  goalId: goalId.optional().describe("Only events about this goal and the tasks and memories under it"),
  limit: limit(100, 30),
});

export const VIEW_KINDS = ["goal_tree", "kanban", "timeline"] as const;
export const VisualizeInput = z.object({ kind: z.enum(VIEW_KINDS), goalId: goalId.optional() });

// Workspace administration
export const CreateAgentInput = z.object({ name: z.string().trim().min(1).max(80) });
export const AgentRefInput = z.object({ agentId: z.string().trim().min(1) });

export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const CreateWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(WORKSPACE_SLUG_PATTERN, "Use lowercase letters, numbers, and dashes (max 40)."),
});

export const InviteMemberInput = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(["admin", "member"]).default("member"),
});
export const InvitationRefInput = z.object({ invitationId: z.string().trim().min(1) });
export const MemberRefInput = z.object({ memberId: z.string().trim().min(1) });
