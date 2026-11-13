import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, max, ne, or, sql, type Column, type SQL } from "drizzle-orm";

import {
  GOAL_STATUSES,
  OPEN_TASK_STATUSES,
  TASK_STATUSES,
  zeroCounts,
  type GoalStatus,
  type TaskStatus,
} from "@/lib/domain";
import { subtreeIds } from "@/lib/goal-tree";
import type { HandoffFilter } from "@/lib/task-views";
import { stageOf, type Stage } from "@/lib/workflow";
import { buildJourneys, fitWindow, TIMELINE_AHEAD_DAYS, timeWindow, type Journey, type TimeWindow } from "@/lib/timeline";

import type { Db } from "../db/client";
import { countWhere } from "../db/raw";
import { agents, events, goals, tasks } from "../db/schema";
import { listAgents, type ListedAgent } from "./agents";
import { inTenant, type Ctx, type Tenant } from "./context";
import { notFound } from "./errors";
import { listActivity, type Activity } from "./events";
import { allGoalsWithProgress, ancestorChain, type GoalWithProgress } from "./goals";
import { recall, type Memory } from "./memory";
import { assertCan } from "./policy";
import { BoardInput, BrowseTasksInput, Empty, GoalRefInput, GoalScopeInput, JourneysInput } from "./schemas";
import { service } from "./service";
import { byUrgency, handedTo, isAwaitingInput, isDueWithinWeek, isOpenTask, isOverdue, selectTaskViews, type TaskView } from "./tasks";
import { loadWorkflow } from "./workflow";

export interface WorkspaceStats {
  tasksByStatus: Record<TaskStatus, number>;
  goalsByStatus: Record<GoalStatus, number>;
  openTasks: number;
  inbox: number;
  overdue: number;
  dueThisWeek: number;
  doneLast7Days: number;
  activeGoals: number;
  pendingApprovals: number;
  /** Open tasks whose agent is waiting on a person's answer. */
  awaitingInput: number;
  /** Goals to approve plus questions to answer: everything that waits on a person. */
  waitingOnYou: number;
  agents: number;
  /** Agents that called the MCP server in the last 24 hours. */
  activeAgents: number;
  lastActivityAt: Date | null;
}

const countByValue = <V extends string>(column: Column, values: readonly V[]) =>
  Object.fromEntries(values.map((value) => [value, countWhere(sql`${column} = ${value}`)])) as Record<V, SQL<number>>;

/** Headline numbers for many workspaces in four grouped queries, regardless of how many workspaces. */
export async function getWorkspaceStats(db: Db, tenantIds: readonly string[]): Promise<Map<string, WorkspaceStats>> {
  if (tenantIds.length === 0) return new Map();
  const ids = [...new Set(tenantIds)];

  const [taskRows, goalRows, agentRows, activityRows] = await Promise.all([
    db
      .select({
        tenantId: tasks.tenantId,
        byStatus: countByValue(tasks.status, TASK_STATUSES),
        overdue: countWhere(isOverdue),
        dueThisWeek: countWhere(isDueWithinWeek),
        awaitingInput: countWhere(isAwaitingInput),
        doneLast7Days: countWhere(sql`${tasks.completedAt} > now() - interval '7 days'`),
      })
      .from(tasks)
      .where(inArray(tasks.tenantId, ids))
      .groupBy(tasks.tenantId),
    db
      .select({ tenantId: goals.tenantId, byStatus: countByValue(goals.status, GOAL_STATUSES) })
      .from(goals)
      .where(inArray(goals.tenantId, ids))
      .groupBy(goals.tenantId),
    db
      .select({
        tenantId: agents.tenantId,
        total: countWhere(sql`${agents.revokedAt} is null`),
        active: countWhere(sql`${agents.revokedAt} is null and ${agents.lastSeenAt} > now() - interval '1 day'`),
      })
      .from(agents)
      .where(inArray(agents.tenantId, ids))
      .groupBy(agents.tenantId),
    db
      .select({ tenantId: events.tenantId, lastActivityAt: max(events.createdAt) })
      .from(events)
      .where(inArray(events.tenantId, ids))
      .groupBy(events.tenantId),
  ]);

  const byTenant = <T extends { tenantId: string }>(rows: T[]) => new Map(rows.map((row) => [row.tenantId, row]));
  const taskMap = byTenant(taskRows);
  const goalMap = byTenant(goalRows);
  const agentMap = byTenant(agentRows);
  const activityMap = byTenant(activityRows);

  return new Map(
    ids.map((id) => {
      const t = taskMap.get(id);
      const tasksByStatus = t?.byStatus ?? zeroCounts(TASK_STATUSES);
      const goalsByStatus = goalMap.get(id)?.byStatus ?? zeroCounts(GOAL_STATUSES);
      const awaitingInput = t?.awaitingInput ?? 0;
      const stats: WorkspaceStats = {
        tasksByStatus,
        goalsByStatus,
        openTasks: OPEN_TASK_STATUSES.reduce((sum, status) => sum + tasksByStatus[status], 0),
        inbox: tasksByStatus.inbox,
        overdue: t?.overdue ?? 0,
        dueThisWeek: t?.dueThisWeek ?? 0,
        doneLast7Days: t?.doneLast7Days ?? 0,
        activeGoals: goalsByStatus.active,
        pendingApprovals: goalsByStatus.proposed,
        awaitingInput,
        waitingOnYou: goalsByStatus.proposed + awaitingInput,
        agents: agentMap.get(id)?.total ?? 0,
        activeAgents: agentMap.get(id)?.active ?? 0,
        lastActivityAt: activityMap.get(id)?.lastActivityAt ?? null,
      };
      return [id, stats];
    }),
  );
}

export interface StatusSummary extends WorkspaceStats {
  workspace: Tenant;
  /** Tasks whose agent asked a person something, longest waiting first. */
  awaitingInputTasks: TaskView[];
  overdueTasks: TaskView[];
  /** Open tasks due today or later, soonest first. */
  dueSoonTasks: TaskView[];
}

export const getStatusSummary = service(Empty, async (ctx): Promise<StatusSummary> => {
  assertCan(ctx, "workspace:read");
  const [stats, awaitingInputTasks, overdueTasks, dueSoonTasks] = await Promise.all([
    getWorkspaceStats(ctx.db, [ctx.tenant.id]),
    selectTaskViews(ctx, isAwaitingInput)
      .orderBy(sql`${tasks.inputRequest}->>'askedAt'`)
      .limit(20),
    selectTaskViews(ctx, isOverdue)
      .orderBy(...byUrgency)
      .limit(10),
    selectTaskViews(ctx, and(isOpenTask, sql`${tasks.dueDate} >= current_date`))
      .orderBy(tasks.dueDate, ...byUrgency)
      .limit(8),
  ]);
  return { workspace: ctx.tenant, ...stats.get(ctx.tenant.id)!, awaitingInputTasks, overdueTasks, dueSoonTasks };
});

/** Open work first, then finished, then dropped. */
const byLifecycle = sql`case when ${isOpenTask} then 0 when ${tasks.status} = 'done' then 1 else 2 end`;

export interface GoalDetail {
  goal: GoalWithProgress;
  /** Root first, excluding the goal itself. */
  ancestors: { id: string; title: string }[];
  children: GoalWithProgress[];
  tasks: TaskView[];
  memories: Memory[];
  activity: Activity[];
}

export const getGoalDetail = service(GoalRefInput, async (ctx, { goalId }): Promise<GoalDetail> => {
  assertCan(ctx, "workspace:read");
  const all = await allGoalsWithProgress(ctx);
  const goal = all.find((candidate) => candidate.id === goalId);
  if (!goal) throw notFound("goal", goalId);

  const [chain, goalTasks, memories, activity] = await Promise.all([
    ancestorChain(ctx, goalId),
    selectTaskViews(ctx, eq(tasks.goalId, goalId))
      .orderBy(byLifecycle, ...byUrgency)
      .limit(200),
    recall(ctx, { goalId, limit: 20 }),
    listActivity(ctx, { goalId, limit: 20 }),
  ]);

  return {
    goal,
    ancestors: chain.slice(1).reverse(),
    children: all.filter((candidate) => candidate.parentId === goalId),
    tasks: goalTasks,
    memories,
    activity,
  };
});

/** Restricts task queries to a goal and its sub-goals; no filter when `goalId` is absent. */
async function goalScope(ctx: Ctx, goalId: string | undefined): Promise<SQL | undefined> {
  if (!goalId) return undefined;
  const hierarchy = await ctx.db
    .select({ id: goals.id, parentId: goals.parentId })
    .from(goals)
    .where(inTenant(ctx, goals));
  if (!hierarchy.some((goal) => goal.id === goalId)) throw notFound("goal", goalId);
  return inArray(tasks.goalId, subtreeIds(hierarchy, goalId));
}

export interface BoardColumn {
  stage: Stage;
  tasks: TaskView[];
}

export interface Board {
  /** One lane per visible stage in flow order, plus any hidden stage that still holds tasks. */
  columns: BoardColumn[];
}

const BOARD_OPEN_LIMIT = 500;

/** The tasks a handoff filter keeps, or nothing to add for all tasks. */
function inHandoff(ctx: Ctx, handoff: HandoffFilter): SQL | undefined {
  if (handoff === "all") return undefined;
  if (handoff === "any") return isNotNull(tasks.delegation);
  if (handoff === "to_me") return handedTo(ctx);
  return eq(tasks.delegation, handoff);
}

export const getBoard = service(BoardInput, async (ctx, { goalId, doneLimit, heldBy, handoff }): Promise<Board> => {
  assertCan(ctx, "workspace:read");
  const scope = await goalScope(ctx, goalId);
  // A finished task is held by no one and in no handover, so filtering by either leaves the Done lane empty.
  const [open, done] = await Promise.all([
    selectTaskViews(ctx, and(isOpenTask, scope, heldBy ? eq(tasks.claimedByAgentId, heldBy) : undefined, inHandoff(ctx, handoff)))
      .orderBy(...byUrgency)
      .limit(BOARD_OPEN_LIMIT),
    heldBy || handoff !== "all"
      ? Promise.resolve([])
      : selectTaskViews(ctx, and(eq(tasks.status, "done"), isNull(tasks.archivedAt), scope))
          .orderBy(desc(tasks.completedAt))
          .limit(doneLimit),
  ]);
  const workflow = await loadWorkflow(ctx);
  const columns = workflow.map((stage) => ({ stage, tasks: [] as TaskView[] }));
  for (const task of [...open, ...done]) {
    const home = stageOf(workflow, task);
    columns.find((column) => column.stage.key === home?.key)?.tasks.push(task);
  }
  return { columns: columns.filter((column) => !column.stage.hidden || column.tasks.length > 0) };
});

/**
 * Tasks for the Tasks page's other layouts, most urgent first: open ones by default, every one but
 * dropped (`all`), or one status. Archived tasks stay off, as on the board. The same goal scope and
 * holder filter as the board, so switching layouts never changes which tasks are meant.
 */
export const browseTasks = service(BrowseTasksInput, async (ctx, { goalId, heldBy, status, handoff, dueFrom, dueTo, undated, limit }): Promise<BrowsedTasks> => {
  assertCan(ctx, "workspace:read");
  const scope = await goalScope(ctx, goalId);
  const which = status === "open" ? isOpenTask : status === "all" ? ne(tasks.status, "dropped") : eq(tasks.status, status);
  const where = and(
    which,
    isNull(tasks.archivedAt),
    scope,
    heldBy ? eq(tasks.claimedByAgentId, heldBy) : undefined,
    inHandoff(ctx, handoff),
    dueFrom ? gte(tasks.dueDate, dueFrom) : undefined,
    dueTo ? lte(tasks.dueDate, dueTo) : undefined,
    undated ? isNull(tasks.dueDate) : undefined,
  );
  const [rows, [counted]] = await Promise.all([
    selectTaskViews(ctx, where).orderBy(...byUrgency).limit(limit),
    ctx.db.select({ total: count() }).from(tasks).where(and(inTenant(ctx, tasks), where)),
  ]);
  return { tasks: rows, total: counted?.total ?? rows.length };
});

/** A page of tasks and how many match in all, so a layout can say when it shows only some. */
export interface BrowsedTasks {
  tasks: TaskView[];
  total: number;
}

/** Tasks with due dates, soonest first, for timeline views. */
export const getTimeline = service(GoalScopeInput, async (ctx, { goalId }): Promise<TaskView[]> => {
  assertCan(ctx, "workspace:read");
  const scope = await goalScope(ctx, goalId);
  return selectTaskViews(ctx, and(isNotNull(tasks.dueDate), ne(tasks.status, "dropped"), scope))
    .orderBy(tasks.dueDate, ...byUrgency)
    .limit(300);
});

export interface Journeys {
  /** The requested window, or a shorter one when the history it covers starts later. */
  window: TimeWindow;
  /** Oldest task first. */
  journeys: Journey<TaskView>[];
  /** More tasks moved in the window than one timetable shows; the newest are kept. */
  truncated: boolean;
}

const JOURNEY_LIMIT = 300;

/** Every task that was open at some point in the window, with the statuses it held over time. */
export const getJourneys = service(JourneysInput, async (ctx, { goalId, days }): Promise<Journeys> => {
  assertCan(ctx, "workspace:read");
  const scope = await goalScope(ctx, goalId);
  const window = timeWindow(days, new Date(), TIMELINE_AHEAD_DAYS);
  // A task closed before the window started has not been touched since, so its updatedAt is older.
  const rows = await selectTaskViews(ctx, and(scope, or(isOpenTask, gte(tasks.updatedAt, window.start))))
    .orderBy(desc(tasks.createdAt))
    .limit(JOURNEY_LIMIT + 1);
  const shown = rows.slice(0, JOURNEY_LIMIT).reverse();

  const log = shown.length
    ? await ctx.db
        .select({ entityId: events.entityId, action: events.action, createdAt: events.createdAt, data: events.data })
        .from(events)
        .where(
          and(
            inTenant(ctx, events),
            eq(events.entityType, "task"),
            inArray(
              events.entityId,
              shown.map((task) => task.id),
            ),
          ),
        )
        .orderBy(asc(events.createdAt), asc(events.id))
    : [];

  const journeys = buildJourneys(shown, log);
  return { window: fitWindow(window, journeys), journeys, truncated: rows.length > JOURNEY_LIMIT };
});

export interface AgentLoad {
  agent: ListedAgent;
  /** Open tasks the agent holds right now. */
  claimed: number;
  completedLast7Days: number;
}

const isCompletion = or(
  eq(events.action, "task.completed"),
  and(eq(events.action, "task.updated"), sql`${events.data}->>'status' = 'done'`),
);

/** What each connected agent holds and has finished this week, busiest first. */
export const getAgentWorkload = service(Empty, async (ctx): Promise<AgentLoad[]> => {
  assertCan(ctx, "workspace:read");
  const [roster, claims, completions] = await Promise.all([
    listAgents(ctx, {}),
    ctx.db
      .select({ agentId: tasks.claimedByAgentId, total: count() })
      .from(tasks)
      .where(and(inTenant(ctx, tasks), isOpenTask, isNotNull(tasks.claimedByAgentId)))
      .groupBy(tasks.claimedByAgentId),
    ctx.db
      .select({ agentId: events.actorId, total: count() })
      .from(events)
      .where(
        and(
          inTenant(ctx, events),
          eq(events.actorType, "agent"),
          isCompletion,
          sql`${events.createdAt} > now() - interval '7 days'`,
        ),
      )
      .groupBy(events.actorId),
  ]);

  const totals = (rows: { agentId: string | null; total: number }[]) =>
    new Map(rows.map((row) => [row.agentId, row.total]));
  const claimed = totals(claims);
  const completed = totals(completions);

  return roster
    .filter((agent) => !agent.revokedAt)
    .map((agent) => ({ agent, claimed: claimed.get(agent.id) ?? 0, completedLast7Days: completed.get(agent.id) ?? 0 }))
    .sort((a, b) => b.claimed + b.completedLast7Days - (a.claimed + a.completedLast7Days));
});
