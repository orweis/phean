import { z } from "zod";

import { isResumeUrl, LINK_KINDS, MAX_LINKS, REQUEST_KINDS, RESUME_URL_SCHEMES } from "@/lib/agent-sessions";
import {
  GOAL_STATUSES,
  INVITABLE_ROLES,
  LIMITS,
  MEMORY_KINDS,
  PRIORITIES,
  SOURCES,
  STATIONS,
  TASK_STATUSES,
  WATCHED_ENTITY_TYPES,
  WEBHOOK_TOPICS,
  WORKSPACE_SLUG_PATTERN,
} from "@/lib/domain";
import { DOCUMENT_FORMATS } from "@/lib/documents";
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

// Workflow
export const StageDraft = z.object({
  key: z.string().trim().min(1).max(LIMITS.stageLabel).optional().describe("An existing stage's key; leave it out to add a stage"),
  label: z.string().trim().min(1).max(LIMITS.stageLabel),
  kind: z.enum(STATIONS),
  hidden: z.boolean().default(false),
});
/** The web form posts the stages as one JSON field; tools and tests pass the array itself. */
const jsonArray = (value: unknown) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};
export const SaveWorkflowInput = z.object({ stages: z.preprocess(jsonArray, z.array(StageDraft).min(1).max(32)) });

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
  status: z
    .enum(["inbox", "backlog", "todo"])
    .default("inbox")
    .describe("inbox: to triage. backlog: accepted, not planned yet. todo: ready to pick up"),
  parentTaskId: taskId.optional().describe("Make this a subtask of an existing task (one level: not of a subtask). Inherits the parent's goal unless goalId is set"),
  links: links.default([]).describe("References people can click: the conversation (kind conversation) and the source message (kind source)"),
});

export const CaptureTasksInput = z.object({ tasks: z.array(TaskDraft).min(1).max(100) });

export const UpdateTaskInput = z.object({
  taskId,
  title: title.optional(),
  description: longText.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  stage: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.stageLabel)
    .nullable()
    .optional()
    .describe("A stage key from whoami's workflow, such as a workspace's own 'review'; sets the status to the stage's kind. null puts it back in its status's own stage"),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: isoDate.nullable().optional(),
  goalId: goalId.nullable().optional(),
  tags: tags.optional(),
  source: z.enum(SOURCES).optional(),
  sourceRef: z.string().trim().max(LIMITS.sourceRef).optional().describe("Fix the origin reference; must not match another task's"),
  parentTaskId: taskId.nullable().optional().describe("Make it a subtask of another task, or null to detach it"),
  links: links.optional().describe("Replaces all of the task's links; [] removes them. To add or remove some, use addLinks and removeLinks"),
  addLinks: links.optional().describe("Links to add; a link whose url is already on the task is updated in place"),
  removeLinks: z.array(z.string().trim().min(1).max(LIMITS.url)).max(MAX_LINKS).optional().describe("URLs of links to remove"),
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
/** The most options a request offers. */
export const MAX_OPTIONS = 8;
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
    .max(MAX_OPTIONS)
    .default([])
    .describe("2-5 short answers to pick from, mutually exclusive unless multiple is true; the human may still write their own"),
  multiple: z
    .boolean()
    .default(false)
    .describe("true when the human may pick several options (which channels to announce on, which candidates to interview); needs 2+ options"),
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
  choices: z
    .array(z.coerce.number().int().min(0).max(MAX_OPTIONS - 1))
    .max(MAX_OPTIONS)
    .default([])
    .describe("For a request that takes several options: the positions of the options picked"),
});

export const RetractAnswerInput = z.object({
  taskId,
  requestId: z.string().trim().min(1).max(LIMITS.ref).describe("The id of the request whose answer is taken back"),
});

export const CompleteTaskInput = z.object({
  taskId,
  note: z.string().trim().max(LIMITS.note).default("").describe("What was done, in one or two sentences"),
});
export const AssignTasksInput = z.object({ taskIds: z.array(taskId).min(1).max(100), goalId });

export const ListTasksInput = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  goalId: goalId.optional(),
  parentTaskId: taskId.optional().describe("Only the subtasks of this task"),
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
export const BoardInput = GoalScopeInput.extend({
  doneLimit: limit(100, 20),
  heldBy: z.string().trim().min(1).optional().describe("Only the open tasks this agent holds (agent id)"),
});
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

export const UpdateMemoryInput = z.object({
  memoryId: z.string().trim().min(1),
  content: z.string().trim().min(1).max(LIMITS.memory).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  tags: tags.optional(),
  goalId: goalId.nullable().optional().describe("The goal it is about, or null for the whole workspace"),
});

export const RecallInput = z.object({
  query: z.string().trim().max(LIMITS.query).optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  goalId: goalId.optional(),
  limit: limit(100, 20),
});

// Documents
const documentId = z.string().trim().min(1).describe("Document id (d_...)");
const documentBody = {
  content: z
    .string()
    .max(LIMITS.documentText)
    .optional()
    .describe("The text, for text formats (markdown, text, json, csv, yaml, mermaid, html)"),
  contentBase64: z
    .string()
    .max(Math.ceil(LIMITS.documentBytes / 3) * 4 + 4)
    .optional()
    .describe("The bytes as base64, for pdf and images (png, jpeg, gif, webp)"),
};
export const AttachDocumentInput = z.object({
  title: z.string().trim().min(1).max(LIMITS.documentTitle),
  format: z
    .enum(DOCUMENT_FORMATS)
    .default("markdown")
    .describe("How Phean shows it: markdown renders (with ```mermaid diagrams), mermaid is one diagram, html is shown as source, pdf and images are shown or downloaded"),
  summary: z.string().trim().max(LIMITS.documentSummary).default("").describe("One or two sentences on what is in it and why, so others can tell without opening it"),
  taskId: taskId.optional().describe("The task it belongs to"),
  goalId: goalId.optional().describe("The goal it belongs to, when it is about a goal rather than one task"),
  ...documentBody,
});
export const UpdateDocumentInput = z.object({
  documentId,
  title: z.string().trim().min(1).max(LIMITS.documentTitle).optional(),
  summary: z.string().trim().max(LIMITS.documentSummary).optional(),
  taskId: taskId.nullable().optional().describe("Move it to another task, or null to detach it"),
  goalId: goalId.nullable().optional(),
  ...documentBody,
  expectedVersion: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("The version you read; if someone changed it since, the update is refused instead of overwriting their edit"),
});
export const DocumentRefInput = z.object({ documentId });
export const ListDocumentsInput = z.object({
  taskId: taskId.optional(),
  goalId: goalId.optional(),
  query: z.string().trim().max(LIMITS.query).optional().describe("Words in the title or summary"),
  limit: limit(100, 50),
});

export const MemoryCountsInput = RecallInput.pick({ query: true });

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
export const CreateAgentInput = z.object({
  name,
  parentAgentId: z.string().trim().min(1).optional().describe("Issue it as a sub-agent of this agent"),
});
export const AgentRefInput = z.object({ agentId: z.string().trim().min(1) });
export const CreateSubagentInput = z.object({
  name,
  purpose: z.string().trim().max(LIMITS.brief).default("").describe("What it does for you, in a line: 'Researches vendors'"),
});

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

// Webhooks and watches
/** Custom headers a webhook endpoint may require. */
export const MAX_WEBHOOK_HEADERS = 10;
/** Headers Phean sets itself, or that would change how the request is framed or routed. */
const RESERVED_HEADERS = new Set([
  "host",
  "content-type",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "expect",
  "te",
  "trailer",
  "user-agent",
  "proxy-authorization",
]);
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;

const WebhookHeaders = z
  .record(z.string(), z.string().max(LIMITS.headerValue))
  .superRefine((headers, issue) => {
    const names = Object.keys(headers);
    if (names.length > MAX_WEBHOOK_HEADERS) issue.addIssue({ code: "custom", message: `At most ${MAX_WEBHOOK_HEADERS} headers.` });
    const seen = new Set<string>();
    for (const name of names) {
      const lower = name.toLowerCase();
      if (!HEADER_NAME.test(name)) issue.addIssue({ code: "custom", message: `"${name}" is not a valid header name.` });
      else if (RESERVED_HEADERS.has(lower) || lower.startsWith("phean-")) issue.addIssue({ code: "custom", message: `Phean sets "${name}" itself; use another header.` });
      if (seen.has(lower)) issue.addIssue({ code: "custom", message: `"${name}" is given twice.` });
      seen.add(lower);
      if (/[\r\n\0]/.test(headers[name]!)) issue.addIssue({ code: "custom", message: `The value of "${name}" must be one line.` });
    }
  });

export const RegisterWebhookInput = z.object({
  url: z.string().trim().min(1).max(LIMITS.url).describe("Your HTTPS endpoint. Phean POSTs signed JSON to it"),
  topics: z
    .array(z.enum(WEBHOOK_TOPICS))
    .min(1)
    .default([...WEBHOOK_TOPICS])
    .describe("decisions: a human answered you, or approved or closed a goal. tasks, goals, memory: changes to the ones you follow"),
  scope: z
    .enum(["related", "all"])
    .default("related")
    .describe("related: only what you follow (what you worked on, plus watch). all: every change in the workspace within the topics"),
  headers: WebhookHeaders.optional().describe(
    "Headers your endpoint requires on every request, e.g. {\"Authorization\": \"Bearer <your endpoint's key>\"}. Stored encrypted and never shown again. Omit to keep the ones already registered; {} removes them",
  ),
});
export const WebhookRefInput = z.object({
  agentId: z.string().trim().min(1).optional().describe("For owners and admins: whose webhook. Agents always act on their own"),
});
export const WatchInput = z.object({
  entityType: z.enum(WATCHED_ENTITY_TYPES),
  entityId: z.string().trim().min(1).describe("The task (t_...), goal (g_...) or memory (m_...) id"),
});
export const ListWatchesInput = z.object({ entityType: z.enum(WATCHED_ENTITY_TYPES).optional() });
