import { z } from "zod";

import { isResumeUrl, LINK_KINDS, MAX_LINKS, REQUEST_KINDS, RESUME_URL_SCHEMES } from "@/lib/agent-sessions";
import {
  GOAL_STATUSES,
  INVITABLE_ROLES,
  LIMITS,
  MEMORY_KINDS,
  PRIORITIES,
  SOURCES,
  TASK_STATUSES,
  WORKSPACE_SLUG_PATTERN,
} from "@/lib/domain";
import { TIMELINE_WINDOWS } from "@/lib/timeline";

const goalId = z.string().trim().min(1).describe("Goal id (g_...)");
const taskId = z.string().trim().min(1).describe("Task id (t_...)");
const title = z.string().trim().min(1).max(LIMITS.title);
const longText = z.string().trim().max(LIMITS.text);
const name = z.string().trim().min(1).max(LIMITS.name);
const isoDate = z.iso.date().describe("Date as YYYY-MM-DD");
const tags = z.array(z.string().trim().min(1).max(LIMITS.tag)).max(20);
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

const APP_SCHEMES = RESUME_URL_SCHEMES.filter((scheme) => !scheme.startsWith("http")).map((scheme) => `${scheme}://`);
const linkUrl = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.url)
  .refine(isResumeUrl, { message: `Use an https link, or an app link (${APP_SCHEMES.join(", ")}).` });

export const LinkInput = z.object({
  url: linkUrl.describe("Permalink people can click: the conversation, message, ticket, or doc"),
  title: z.string().trim().max(LIMITS.linkTitle).default("").describe("Short label, e.g. \"This chat\" or \"Dana's email\""),
  kind: z
    .enum(LINK_KINDS)
    .default("source")
    .describe("conversation: back to the chat or thread with the human. source: the email, Slack message, event, ticket or PR. doc: a draft or file. other."),
});
const links = z.array(LinkInput).max(MAX_LINKS);

// Tasks
export const TaskDraft = z.object({
  title,
  description: longText.default(""),
  source: z.enum(SOURCES).default("manual"),
  sourceRef: z
    .string()
    .trim()
    .max(LIMITS.sourceRef)
    .default("")
    .describe("Stable origin reference (message link, thread id, event id). Used to skip duplicates."),
  dueDate: isoDate.optional(),
  priority: z.enum(PRIORITIES).default("medium"),
  goalId: goalId.optional(),
  tags: tags.default([]),
  status: z.enum(["inbox", "todo"]).default("inbox"),
  links: links.default([]).describe("References people can click: the conversation (kind conversation) and the source message (kind source)"),
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
  links: links.optional().describe("Replaces the task's links; [] removes them"),
});

export const TaskRefInput = z.object({ taskId });

const ref = (max: number) => z.string().trim().max(max).optional();

export const SessionInput = z
  .object({
    url: z
      .string()
      .trim()
      .max(LIMITS.url)
      .refine((value) => value === "" || isResumeUrl(value), {
        message: `Use an https link, or an app link (${APP_SCHEMES.join(", ")}). Otherwise give a sessionId or command.`,
      })
      .optional()
      .describe("Link that opens this conversation or message: the one-click way back for a human. Pass it whenever your client has one."),
    sessionId: ref(LIMITS.ref).describe("Your session, conversation or thread id"),
    messageId: ref(LIMITS.ref).describe("The message to pick up from, if your client has message ids"),
    command: ref(LIMITS.command).describe("Shell command that resumes this session, e.g. `claude --resume <id>`"),
    app: ref(LIMITS.name).describe("Where this session lives: Claude Code, Cursor, ChatGPT, Slack..."),
    brief: z.string().trim().max(LIMITS.brief).default("").describe("Where things stand, in a sentence"),
  })
  .refine((session) => Boolean(session.url || session.sessionId || session.command), {
    message: "Give a url, a sessionId or a command, so a human can find this session.",
  })
  .describe("Where a human can resume this work with you");

export const LinkSessionInput = z.object({ taskId, session: SessionInput });
export const ClaimTaskInput = z.object({
  taskId,
  session: SessionInput.optional().describe("Where a human can resume this work with you; same as link_session"),
});
export const AskInput = z.object({
  taskId,
  question: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.question)
    .describe("What you need from the human, answerable without opening anything else"),
  kind: z
    .enum(REQUEST_KINDS)
    .default("question")
    .describe("'decision' when the human must choose or sign off (give options); 'question' when you need information"),
  context: longText.default("").describe("The facts, the trade-offs, and your recommendation, for a human reading it cold"),
  options: z
    .array(z.string().trim().min(1).max(LIMITS.option))
    .max(8)
    .default([])
    .describe("2-5 short, mutually exclusive answers to pick from; the human may still write their own"),
  links: links.default([]).describe("References for this question: the conversation (kind conversation), the sources it is about (kind source), docs"),
  session: SessionInput.optional().describe("Where the human can answer you; include a url whenever you have one"),
});
export const CollectAnswersInput = z.object({
  taskIds: z.array(taskId).max(100).optional().describe("Only answers on these tasks; omit for all of yours"),
});
/** Kept under the MCP route's maxDuration, with room to spare. */
export const MAX_WAIT_SECONDS = 240;
export const WaitForAnswersInput = CollectAnswersInput.extend({
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_WAIT_SECONDS)
    .default(55)
    .describe(`How long to wait for an answer, at most ${MAX_WAIT_SECONDS}s. Some clients give up on a tool call after 60s.`),
});
export const DecisionsInput = z.object({ limit: limit(200, 50) });
export const AnswerInput = z.object({
  taskId,
  answer: z.string().trim().max(LIMITS.note).default("").describe("Empty marks the question answered elsewhere"),
});

export const CompleteTaskInput = z.object({
  taskId,
  note: z.string().trim().max(LIMITS.note).default("").describe("What was done, in one or two sentences"),
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
  content: z.string().trim().min(1).max(LIMITS.memory),
  kind: z.enum(MEMORY_KINDS).default("note"),
  tags: tags.default([]),
  goalId: goalId.optional(),
  taskId: taskId.optional(),
});

export const RecallInput = z.object({
  query: z.string().trim().max(LIMITS.query).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  goalId: goalId.optional(),
  limit: limit(100, 20),
});

export const MemoryRefInput = z.object({ memoryId: z.string().trim().min(1) });

// Search, activity, views
export const SEARCH_KINDS = ["goal", "task", "memory"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SearchInput = z.object({
  query: z.string().trim().min(1).max(LIMITS.query),
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
export const CreateAgentInput = z.object({ name });
export const AgentRefInput = z.object({ agentId: z.string().trim().min(1) });

export const CreateWorkspaceInput = z.object({
  name,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(new RegExp(`^${WORKSPACE_SLUG_PATTERN}$`), `Use lowercase letters, numbers, and dashes (max ${LIMITS.slug}).`),
});

export const InviteMemberInput = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(INVITABLE_ROLES).default("member"),
});
export const InvitationRefInput = z.object({ invitationId: z.string().trim().min(1) });
export const MemberRefInput = z.object({ memberId: z.string().trim().min(1) });
