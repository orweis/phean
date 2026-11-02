import { and, desc, eq, inArray, isNotNull, max, ne, sql, type Column, type SQL } from "drizzle-orm";

import {
  BOARD_COLUMNS,
  GOAL_STATUSES,
  OPEN_TASK_STATUSES,
  TASK_STATUSES,
  type GoalStatus,
  type TaskStatus,
} from "@/lib/domain";
import { subtreeIds } from "@/lib/goal-tree";

import type { Db } from "../db/client";
import { countWhere } from "../db/raw";
import { agents, events, goals, tasks } from "../db/schema";
import type { Ctx, Tenant } from "./context";
import { notFound } from "./errors";
import { listActivity, type Activity } from "./events";
import { allGoalsWithProgress, ancestorChain, type GoalWithProgress } from "./goals";
import { recall, type Memory } from "./memory";
import { assertCan } from "./policy";
import { BoardInput, Empty, GoalRefInput, GoalScopeInput } from "./schemas";
import { service } from "./service";
import { byUrgency, isDueWithinWeek, isOpenTask, isOverdue, selectTaskViews, type TaskView } from "./tasks";

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
  agents: number;
  /** Agents that called the MCP server in the last 24 hours. */
  activeAgents: number;
  lastActivityAt: Date | null;
}

const zeroCounts = <V extends string>(values: readonly V[]) =>
  Object.fromEntries(values.map((value) => [value, 0])) as Record<V, number>;

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
  overdueTasks: TaskView[];
}

export const getStatusSummary = service(Empty, async (ctx): Promise<StatusSummary> => {
  assertCan(ctx, "workspace:read");
  const [stats, overdueTasks] = await Promise.all([
    getWorkspaceStats(ctx.db, [ctx.tenant.id]),
    selectTaskViews(ctx, isOverdue)
      .orderBy(...byUrgency)
      .limit(10),
  ]);
  return { workspace: ctx.tenant, ...stats.get(ctx.tenant.id)!, overdueTasks };
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
    .where(eq(goals.tenantId, ctx.tenant.id));
  if (!hierarchy.some((goal) => goal.id === goalId)) throw notFound("goal", goalId);
  return inArray(tasks.goalId, subtreeIds(hierarchy, goalId));
}

export type BoardStatus = (typeof BOARD_COLUMNS)[number];

export interface Board {
  columns: { status: BoardStatus; tasks: TaskView[] }[];
}

const BOARD_OPEN_LIMIT = 500;

export const getBoard = service(BoardInput, async (ctx, { goalId, doneLimit }): Promise<Board> => {
  assertCan(ctx, "workspace:read");
  const scope = await goalScope(ctx, goalId);
  const [open, done] = await Promise.all([
    selectTaskViews(ctx, and(isOpenTask, scope))
      .orderBy(...byUrgency)
      .limit(BOARD_OPEN_LIMIT),
    selectTaskViews(ctx, and(eq(tasks.status, "done"), scope))
      .orderBy(desc(tasks.completedAt))
      .limit(doneLimit),
  ]);
  return {
    columns: BOARD_COLUMNS.map((status) => ({
      status,
      tasks: status === "done" ? done : open.filter((task) => task.status === status),
    })),
  };
});

/** Tasks with due dates, soonest first, for timeline views. */
export const getTimeline = service(GoalScopeInput, async (ctx, { goalId }): Promise<TaskView[]> => {
  assertCan(ctx, "workspace:read");
  const scope = await goalScope(ctx, goalId);
  return selectTaskViews(ctx, and(isNotNull(tasks.dueDate), ne(tasks.status, "dropped"), scope))
    .orderBy(tasks.dueDate, ...byUrgency)
    .limit(300);
});
