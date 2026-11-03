import type { z } from "zod";

import { TASK_STATUS_META } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { subtreeIds } from "@/lib/goal-tree";
import { routes } from "@/lib/routes";

import { listActivity } from "../domain/events";
import { createGoal, listGoals, updateGoal } from "../domain/goals";
import { forget, recall, remember } from "../domain/memory";
import { getBoard, getGoalDetail, getStatusSummary, getTimeline } from "../domain/overview";
import { ACTIONS, can } from "../domain/policy";
import { Empty, GoalRefInput, VisualizeInput } from "../domain/schemas";
import { search } from "../domain/search";
import {
  assignTasksToGoal,
  captureTasks,
  claimTask,
  completeTask,
  listTasks,
  releaseTask,
  suggestNextActions,
  updateTask,
} from "../domain/tasks";
import { planningScaffold } from "./guidance";
import { defineTool, type PheanTool, serviceTool, type ToolContext } from "./tool";
import { fenced, goalTreeMermaid, kanbanMermaid, timelineMermaid } from "./views";

const goalUrl = (ctx: ToolContext, goalId: string) => ctx.url(routes.goal(ctx.tenant.slug, goalId));

async function visualize(ctx: ToolContext, { kind, goalId }: z.output<typeof VisualizeInput>) {
  if (kind === "kanban") {
    const board = await getBoard(ctx, { goalId });
    const summary = board.columns.map((column) => `${TASK_STATUS_META[column.status].label}: ${column.tasks.length}`).join(" · ");
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
    description: "Your agent identity, the workspace you are connected to, what you may do, and the dashboard link to share with humans.",
    input: Empty,
    readOnly: true,
    run: async (ctx) => ({
      agent: { id: ctx.actor.id, name: ctx.actor.name },
      workspace: ctx.tenant,
      dashboardUrl: ctx.url(routes.workspace(ctx.tenant.slug)),
      permissions: ACTIONS.filter((action) => can(ctx.actor, action)),
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
      "Record up to 100 tasks found in your sources in one call. Set source and a stable sourceRef (message link, thread or event id): items any agent already captured are skipped and reported in 'duplicates'. New tasks land in the inbox unless status is 'todo'.",
    service: captureTasks,
  }),
  serviceTool({
    name: "list_tasks",
    title: "List tasks",
    description: "Tasks filtered by status, goal, priority, claim (mine, unclaimed), or due date, most urgent first. Each includes its goal title and who has claimed it.",
    readOnly: true,
    service: listTasks,
    key: "tasks",
  }),
  serviceTool({
    name: "update_task",
    title: "Update task",
    description: "Change a task's title, description, status, priority, due date (null clears), goal (null unfiles), or tags. Fails if another agent has claimed it.",
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
    description: "Take ownership of a task before working on it, so other agents leave it alone. Moves it to 'in_progress'. Fails with the claimant's name if another agent got there first.",
    service: claimTask,
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
    description: "Mark a task done, with a one or two sentence note on what you did. The note is appended to the task for humans to review.",
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
    name: "forget",
    title: "Forget",
    description: "Delete a memory that is wrong or obsolete. Agents can only delete memories they saved.",
    destructive: true,
    service: forget,
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
      "Headline numbers: tasks and goals by status, overdue and due this week, goals awaiting approval, active agents, plus the most urgent overdue tasks and the next tasks coming due.",
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
];
