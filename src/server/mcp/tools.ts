import type { z } from "zod";

import { pluralize } from "@/lib/format";
import { subtreeIds } from "@/lib/goal-tree";
import { routes } from "@/lib/routes";

import { listActivity } from "../domain/events";
import { createGoal, listGoals, updateGoal } from "../domain/goals";
import { forget, recall, remember, updateMemory } from "../domain/memory";
import { createSubagent, revokeAgent } from "../domain/agents";
import { getBoard, getGoalDetail, getStatusSummary, getTimeline } from "../domain/overview";
import { ACTIONS, can } from "../domain/policy";
import { AskInput, Empty, GoalRefInput, VisualizeInput } from "../domain/schemas";
import { search } from "../domain/search";
import {
  assignTasksToGoal,
  captureTasks,
  claimTask,
  collectAnswers,
  completeTask,
  getTask,
  linkSession,
  listTasks,
  releaseTask,
  requestInput,
  resolveInput,
  suggestNextActions,
  updateTask,
  waitForAnswers,
} from "../domain/tasks";
import { deleteWebhook, getWebhook, listWatches, pingWebhook, registerWebhook, unwatch, watch } from "../domain/webhooks";
import { SIGNATURE_HEADER } from "../webhooks/signing";
import { planningScaffold } from "./guidance";
import { defineTool, type PheanTool, serviceTool, type ToolContext } from "./tool";
import { attachDocument, deleteDocument, getDocument, listDocuments, updateDocument } from "../domain/documents";
import { getWorkflow } from "../domain/workflow";
import { fenced, goalTreeMermaid, kanbanMermaid, timelineMermaid } from "./views";

const goalUrl = (ctx: ToolContext, goalId: string) => ctx.url(routes.goal(ctx.tenant.slug, goalId));

async function visualize(ctx: ToolContext, { kind, goalId }: z.output<typeof VisualizeInput>) {
  if (kind === "kanban") {
    const board = await getBoard(ctx, { goalId });
    const summary = board.columns.map((column) => `${column.stage.label}: ${column.tasks.length}`).join(" · ");
    return { kind, mermaid: kanbanMermaid(board), summary: `${summary} (done shows the most recent)` };
  }
  if (kind === "timeline") {
    const tasks = await getTimeline(ctx, { goalId });
    return { kind, mermaid: timelineMermaid(tasks), summary: `${pluralize(tasks.length, "task")} with due dates.` };
  }
  const allGoals = await listGoals(ctx, {});
  const board = goalId ? await getBoard(ctx, { goalId, doneLimit: 10 }) : null;
  const goals = goalId ? allGoals.filter((goal) => subtreeIds(allGoals, goalId).includes(goal.id)) : allGoals;
  const tasks = board?.columns.flatMap((column) => column.tasks) ?? [];
  const open = goals.reduce((sum, goal) => sum + goal.own.open, 0);
  return {
    kind,
    mermaid: goalTreeMermaid(goals, tasks),
    summary: `${pluralize(goals.length, "goal")}, ${pluralize(open, "open task")} under them.`,
  };
}

export const TOOLS: readonly PheanTool[] = [
  defineTool({
    name: "whoami",
    title: "Who am I",
    description:
      "Your agent identity, the workspace you are connected to, what you may do, the dashboard link to share with humans, and the board's stages (workflow): each has a key, a name people see, and the status kind it belongs to. Move a task to a workspace's own stage with update_task stage.",
    input: Empty,
    readOnly: true,
    run: async (ctx) => ({
      agent: { id: ctx.actor.id, name: ctx.actor.name },
      workspace: ctx.tenant,
      dashboardUrl: ctx.url(routes.workspace(ctx.tenant.slug)),
      permissions: ACTIONS.filter((action) => can(ctx.actor, action)),
      workflow: (await getWorkflow(ctx, {})).map(({ key, label, kind, hidden }) => ({ key, label, status: kind, ...(hidden && { hidden }) })),
      serverTime: new Date().toISOString(),
    }),
  }),

  // Goals
  defineTool({
    name: "create_goal",
    title: "Create goal",
    description:
      "Propose a goal (optionally as a sub-goal). Goals created by agents start as 'proposed' until a human approves them in the web app; share the returned reviewUrl with the human. Search first to avoid duplicates.",
    input: createGoal.schema,
    run: async (ctx, input) => {
      const goal = await createGoal(ctx, input);
      return {
        goal,
        reviewUrl: goalUrl(ctx, goal.id),
        ...(goal.status === "proposed" && { note: "Proposed. A human must approve it in Phean before it counts as active." }),
      };
    },
  }),
  serviceTool({
    name: "update_goal",
    title: "Update goal",
    description: "Edit a goal's title or description, or move it under another goal (parentGoalId null makes it top-level). Status changes are for humans in the web app.",
    service: updateGoal,
    key: "goal",
  }),
  serviceTool({
    name: "list_goals",
    title: "List goals",
    description: "All goals as a depth-first tree (depth, parentId) with task counts and progress rolled up from sub-goals.",
    readOnly: true,
    service: listGoals,
    key: "goals",
  }),
  defineTool({
    name: "get_goal",
    title: "Get goal",
    description: "One goal with its ancestors, sub-goals, tasks, linked memories, and recent activity.",
    input: getGoalDetail.schema,
    readOnly: true,
    run: async (ctx, input) => ({ ...(await getGoalDetail(ctx, input)), url: goalUrl(ctx, input.goalId) }),
  }),

  // Tasks
  serviceTool({
    name: "capture_tasks",
    title: "Capture tasks",
    description:
      "Record up to 100 tasks found in your sources in one call. Set source and a stable sourceRef (message link, thread or event id): items any agent already captured are skipped and reported in 'duplicates'. Add links people can click: the source message (kind 'source') and the conversation where the work came up (kind 'conversation'). Pass parentTaskId to capture the steps of a bigger task as its subtasks. New tasks land in the inbox unless status is 'backlog' (accepted, not planned yet) or 'todo' (ready to pick up). File each under the goal it serves (goalId); if no goal fits but several tasks share an outcome, propose one with create_goal first.",
    service: captureTasks,
  }),
  serviceTool({
    name: "list_tasks",
    title: "List tasks",
    description: "Tasks filtered by status, goal, parent task (its subtasks), priority, claim (mine, unclaimed), or due date, most urgent first. Each includes its goal title, who has claimed it, its parent's title, and its subtask progress.",
    readOnly: true,
    service: listTasks,
    key: "tasks",
  }),
  defineTool({
    name: "get_task",
    title: "Get task",
    description:
      "One task with everything on it: links, agent sessions, its open question and answered ones, its parent task, its subtasks, and its recent activity. Read it before fixing a task.",
    input: getTask.schema,
    readOnly: true,
    run: async (ctx, input) => ({ ...(await getTask(ctx, input)), boardUrl: ctx.url(routes.board(ctx.tenant.slug)) }),
  }),
  serviceTool({
    name: "update_task",
    title: "Update task",
    description:
      "Fix or update a task: title, description, status or stage (a workspace's own stage key from whoami, such as 'review', which also sets the status), priority, due date (null clears), goal (null unfiles), tags, source and sourceRef (must not match another task's), or parentTaskId (make it a subtask of another task, null detaches it; one level deep). Links: addLinks adds or updates links by url, removeLinks removes urls, links replaces them all. Only the fields you pass change. Status changes fail if another agent has claimed the task.",
    service: updateTask,
    key: "task",
  }),
  serviceTool({
    name: "assign_tasks_to_goal",
    title: "Assign tasks to goal",
    description: "File several tasks under one goal. Inbox tasks become 'todo', since filing them is the triage step.",
    service: assignTasksToGoal,
    key: "tasks",
  }),
  serviceTool({
    name: "claim_task",
    title: "Claim task",
    description:
      "Take ownership of a task before working on it, so other agents leave it alone. Moves it to 'in_progress'. Pass 'session' (as in link_session) so humans can resume the work with you. Fails with the claimant's name if another agent got there first.",
    service: claimTask,
    key: "task",
  }),
  serviceTool({
    name: "link_session",
    title: "Link session",
    description:
      "Attach this session to a task so a human can pick the work up with you from Phean: a url that opens this conversation or message (best: one click), your session id, message id, or the command that resumes you, plus a one-line brief. One per agent: linking again replaces yours. Call it when you start or resume work on a task.",
    service: linkSession,
    key: "task",
  }),
  defineTool({
    name: "request_input",
    title: "Request input",
    description:
      "Ask the human something you need to go on with a task. kind 'decision' when they must choose or sign off (give 2-5 options; set multiple when several may be picked together), 'question' when you need information. Put the facts, trade-offs and your recommendation in context, and add links: back to this conversation (kind 'conversation') and to the sources it is about (kind 'source'). Include 'session' with a url whenever you have one. It shows on the human's Decisions page until they answer. Get the answer with wait_for_answers (blocks until they answer) or collect_answers (later). One open request per task; asking again replaces yours.",
    input: AskInput,
    run: async (ctx, input) => ({
      task: await requestInput(ctx, input),
      decisionsUrl: ctx.url(routes.decisions(ctx.tenant.slug)),
      note: "Share decisionsUrl if the human is not in this conversation. Then call wait_for_answers to wait for the answer, or collect_answers later.",
    }),
  }),
  defineTool({
    name: "wait_for_answers",
    title: "Wait for answers",
    description:
      "Block until the human answers one of your questions or decisions in Phean (only on taskIds, if given), then return the answers and mark them collected. Returns timedOut=true with stillOpen when nobody answered in time: tell the human what you are waiting on, then wait again or do other work. Answers are delivered once, here or through collect_answers.",
    input: waitForAnswers.schema,
    run: async (ctx, input) => waitForAnswers(ctx, input),
  }),
  serviceTool({
    name: "collect_answers",
    title: "Collect answers",
    description:
      "Answers the human gave to your questions and decisions since you last collected, oldest first, each delivered once. outcome 'answered' carries their answer (with chosenOption when it picks exactly one of your options, and chosenOptions listing every option picked, several for a request asked with multiple); 'answered_elsewhere' means they answered you in your conversation. Call it at the start of every session and before acting on work that had an open question.",
    service: collectAnswers,
    key: "answers",
  }),
  serviceTool({
    name: "resolve_input",
    title: "Resolve input",
    description: "Close your open question on a task once you have the answer, in your conversation or from Phean, so it stops waiting on the human.",
    service: resolveInput,
    key: "task",
  }),
  serviceTool({
    name: "release_task",
    title: "Release task",
    description: "Give up your claim on a task you cannot finish; it goes back to 'todo' for others.",
    service: releaseTask,
    key: "task",
  }),
  serviceTool({
    name: "complete_task",
    title: "Complete task",
    description:
      "Mark a task done, with a one or two sentence note on what you did. The note is appended to the task for humans to review, and any open question of yours on it is closed.",
    service: completeTask,
    key: "task",
  }),
  serviceTool({
    name: "suggest_next_actions",
    title: "Suggest next actions",
    description: "The most urgent open tasks (priority, then due date, then age), skipping tasks claimed by other agents. The answer to 'what should I do next?'.",
    readOnly: true,
    service: suggestNextActions,
    key: "tasks",
  }),

  // Memory
  serviceTool({
    name: "remember",
    title: "Remember",
    description: "Save a durable fact, preference, decision, or context note to the workspace's long-term memory, shared with every agent. Optionally link it to a goal or task.",
    service: remember,
    key: "memory",
  }),
  serviceTool({
    name: "recall",
    title: "Recall",
    description: "Look up long-term memory by text (prefix matching), kind, or goal. Without a query, returns the most recently updated memories.",
    readOnly: true,
    service: recall,
    key: "memories",
  }),
  serviceTool({
    name: "update_memory",
    title: "Update memory",
    description: "Correct a memory you saved that has gone wrong or stale: its content, kind, tags, or goal (null for the whole workspace). Only the fields you pass change. Agents edit only their own memories; for someone else's, remember a correction instead.",
    service: updateMemory,
    key: "memory",
  }),
  serviceTool({
    name: "forget",
    title: "Forget",
    description: "Delete a memory that is wrong or obsolete. Agents can only delete memories they saved.",
    destructive: true,
    service: forget,
  }),

  // Sub-agents
  defineTool({
    name: "create_subagent",
    title: "Create sub-agent",
    description:
      "Issue a Phean token of its own for a sub-agent you run (a worker you spawn, a specialist you delegate to), so its work is attributed to it and people see it under you on the Agents page. A sub-agent can also simply share your token and name itself with the Phean-Agent-Name header (or ?agent=Name on the MCP URL); Phean then detects it under you without a token of its own. Give it a name and a one-line purpose. The token is shown once: hand it to the sub-agent's MCP connection and never put it in chat, a task or a document. One level deep: sub-agents cannot have their own. Revoke it with revoke_subagent when its job is done.",
    input: createSubagent.schema,
    run: async (ctx, input) => {
      const { agent, token } = await createSubagent(ctx, input);
      return { subagent: agent, token, mcpUrl: ctx.url(routes.mcp()), note: "Shown once. Configure the sub-agent with this token as its bearer token." };
    },
  }),
  serviceTool({
    name: "revoke_subagent",
    title: "Revoke sub-agent",
    description: "Cut off one of your own sub-agents once its job is done; its past work stays attributed to it.",
    destructive: true,
    service: revokeAgent,
    key: "subagent",
  }),

  // Documents
  defineTool({
    name: "attach_document",
    title: "Attach document",
    description:
      "Attach a document to a task (taskId) or goal (goalId): a draft for a person to review, a handoff note for the next agent, a report, research, a diagram. Prefer markdown (```mermaid blocks render as diagrams). Text goes in content; pdf and images go base64 in contentBase64 (up to 5 MB). Give it a one-line summary. When there is no link to point at, attach the material as a document and put the returned url in the task's or question's links (kind 'doc').",
    input: attachDocument.schema,
    run: async (ctx, input) => {
      const document = await attachDocument(ctx, input);
      return { document, url: ctx.url(routes.document(ctx.tenant.slug, document.id)) };
    },
  }),
  defineTool({
    name: "get_document",
    title: "Get document",
    description:
      "Read a document: its metadata (version, who changed it last) and its content (text, or base64 for pdf and images). Read the documents on a task (get_task lists them) before picking up its work.",
    input: getDocument.schema,
    readOnly: true,
    run: async (ctx, input) => {
      const result = await getDocument(ctx, input);
      return { ...result, url: ctx.url(routes.document(ctx.tenant.slug, result.document.id)) };
    },
  }),
  serviceTool({
    name: "list_documents",
    title: "List documents",
    description: "Documents on a task or goal, or matching words in their title or summary, most recently changed first. Metadata only; get_document reads one.",
    readOnly: true,
    service: listDocuments,
    key: "documents",
  }),
  serviceTool({
    name: "update_document",
    title: "Update document",
    description:
      "Edit a document: new content (a new version), title, summary, or the task or goal it is attached to. Pass expectedVersion (the version you read) so you never overwrite a person's newer edit. Agents edit only documents they attached or a person wrote.",
    service: updateDocument,
    key: "document",
  }),
  serviceTool({
    name: "delete_document",
    title: "Delete document",
    description: "Delete a document that is wrong or obsolete. Agents can only delete documents they attached.",
    destructive: true,
    service: deleteDocument,
  }),

  // Search, planning, views, coordination
  serviceTool({
    name: "search",
    title: "Search",
    description: "Full-text search across goals, tasks, and memories (prefix matching: 'audit' finds 'auditor'). Use before capturing or creating goals.",
    readOnly: true,
    service: search,
    key: "results",
  }),
  defineTool({
    name: "plan_goal",
    title: "Plan goal",
    description: "Start detailed planning for a goal: returns the goal's current sub-goals, tasks, and memories plus a planning scaffold to work through with the human.",
    input: GoalRefInput,
    readOnly: true,
    run: async (ctx, input) => {
      const detail = await getGoalDetail(ctx, input);
      return {
        scaffold: planningScaffold(detail.goal.title, detail.goal.id),
        goal: detail.goal,
        subGoals: detail.children,
        tasks: detail.tasks,
        memories: detail.memories,
      };
    },
    format: ({ scaffold, ...context }) => `${scaffold}\n\nCurrent state:\n${JSON.stringify(context)}`,
  }),
  defineTool({
    name: "visualize",
    title: "Visualize",
    description:
      "Mermaid diagram of the workspace: 'goal_tree' (goal hierarchy with progress; with goalId, also its tasks), 'kanban' (board by status), or 'timeline' (gantt of due dates). Show it to the human in a mermaid code block.",
    input: VisualizeInput,
    readOnly: true,
    run: visualize,
    format: ({ mermaid, summary }) => `${fenced(mermaid)}\n\n${summary}`,
  }),
  defineTool({
    name: "get_status_summary",
    title: "Status summary",
    description:
      "Headline numbers: tasks and goals by status, overdue and due this week, goals awaiting approval, questions agents asked the human, active agents, plus the open questions, the most urgent overdue tasks, and the next tasks coming due.",
    input: Empty,
    readOnly: true,
    run: async (ctx) => ({
      ...(await getStatusSummary(ctx, {})),
      dashboardUrl: ctx.url(routes.workspace(ctx.tenant.slug)),
    }),
  }),
  defineTool({
    name: "get_activity",
    title: "Get activity",
    description:
      "What humans and other agents did, newest first, optionally only since a timestamp or for one goal. Pass the returned latestAt as 'since' next time to see only new events (the boundary event repeats).",
    input: listActivity.schema,
    readOnly: true,
    run: async (ctx, input) => {
      const events = await listActivity(ctx, input);
      return { events, latestAt: events[0]?.createdAt.toISOString() ?? input.since ?? null };
    },
  }),

  // Webhooks: Phean calls you when something you follow changes
  defineTool({
    name: "register_webhook",
    title: "Register webhook",
    description:
      "Have Phean call your HTTPS endpoint as soon as something you follow changes: a human answers your question or decides on your goal (topic decisions), or a task, goal or memory you follow changes (tasks, goals, memory). You follow what you work on automatically; add more with watch. scope 'all' sends every change in the workspace instead. If your endpoint needs its own key, pass it in headers (e.g. {'Authorization': 'Bearer ...'}); Phean sends them with every request, stores them encrypted, and never shows them again. One webhook per agent: registering again replaces it and rotates the secret, and keeps your headers unless you pass headers ({} removes them). The secret is returned once; verify each request with it.",
    input: registerWebhook.schema,
    run: async (ctx, input) => {
      const { webhook, secret } = await registerWebhook(ctx, input);
      return {
        webhook,
        secret,
        verify: `Each request is a POST with JSON {type: "phean.events", events: [...]} and a ${SIGNATURE_HEADER} header "t=<unix seconds>,v1=<hex>": v1 = HMAC-SHA256(secret, "<t>.<raw body>"). Reject it if v1 differs or t is over 5 minutes old. Use the whole secret string as the HMAC key and the raw body bytes (verify before parsing JSON); compare in constant time. Answer 2xx quickly; Phean retries failures with backoff, so de-duplicate by eventId. The phean-webhooks skill has ready-made Node and Python verifiers. Events say what changed and why you got them; call get_task, collect_answers or get_goal for the current state.`,
        next: "Call ping_webhook to check your endpoint now.",
      };
    },
  }),
  serviceTool({
    name: "get_webhook",
    title: "Get webhook",
    description: "Your webhook: its URL, topics and scope, the names of the headers it sends (not their values), whether it is active (or why it was disabled), delivery counts, and the latest deliveries with any errors.",
    readOnly: true,
    service: getWebhook,
  }),
  serviceTool({
    name: "ping_webhook",
    title: "Ping webhook",
    description: "Send a signed test request (type phean.ping, no events) to your webhook now and report the status code, latency, or error.",
    service: pingWebhook,
    key: "result",
  }),
  serviceTool({
    name: "delete_webhook",
    title: "Delete webhook",
    description: "Remove your webhook. Anything not yet sent to it is dropped; your watches stay.",
    destructive: true,
    service: deleteWebhook,
  }),
  serviceTool({
    name: "watch",
    title: "Watch",
    description:
      "Follow a task, goal or memory, so its changes reach your webhook. You already follow everything you created, claimed, asked about, updated or saved. Watching a goal also covers the tasks and memories filed under it and new sub-goals created under it.",
    service: watch,
  }),
  serviceTool({
    name: "unwatch",
    title: "Unwatch",
    description: "Stop following a task, goal or memory.",
    service: unwatch,
  }),
  serviceTool({
    name: "list_watches",
    title: "List watches",
    description: "Everything you follow, with titles, and whether you chose it (manual) or Phean added it because you worked on it (auto).",
    readOnly: true,
    service: listWatches,
    key: "watches",
  }),
];
