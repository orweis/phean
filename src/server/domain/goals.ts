import { and, asc, count, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { GOAL_MAX_DEPTH, GOAL_STATUS_META, type GoalStatus } from "@/lib/domain";
import { type TaskCounts, withProgress, type WithProgress } from "@/lib/goal-tree";

import { publicColumns } from "../db/columns";
import { newId } from "../db/ids";
import { queryRows } from "../db/raw";
import { goals, tasks, type GoalRow } from "../db/schema";
import { createdByFields, inTransaction, type Ctx } from "./context";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent, type EventAction } from "./events";
import { assertCan } from "./policy";
import { CreateGoalInput, ListGoalsInput, SetGoalStatusInput, UpdateGoalInput } from "./schemas";
import { service } from "./service";

export type Goal = Omit<GoalRow, "tenantId" | "search">;
export type GoalWithProgress = WithProgress<Goal>;

export const goalColumns = publicColumns(goals, ["tenantId", "search"]);

export async function findGoal(ctx: Ctx, goalId: string): Promise<Goal> {
  const [goal] = await ctx.db
    .select(goalColumns)
    .from(goals)
    .where(and(eq(goals.tenantId, ctx.tenant.id), eq(goals.id, goalId)));
  if (!goal) throw notFound("goal", goalId);
  return goal;
}

/** Throws unless every id refers to a goal in this tenant. */
export async function assertGoalsExist(ctx: Ctx, goalIds: readonly string[]): Promise<void> {
  const unique = [...new Set(goalIds)];
  if (unique.length === 0) return;
  const found = await ctx.db
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.tenantId, ctx.tenant.id), inArray(goals.id, unique)));
  const missing = unique.find((id) => !found.some((goal) => goal.id === id));
  if (missing) throw notFound("goal", missing);
}

/** The goal itself followed by its ancestors, nearest first. */
export async function ancestorChain(ctx: Ctx, goalId: string): Promise<{ id: string; title: string }[]> {
  return queryRows(
    ctx.db,
    sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, title, 0 AS level FROM goals
        WHERE tenant_id = ${ctx.tenant.id} AND id = ${goalId}
        UNION ALL
        SELECT g.id, g.parent_id, g.title, c.level + 1 FROM goals g
        JOIN chain c ON g.id = c.parent_id
        WHERE g.tenant_id = ${ctx.tenant.id}
      ) CYCLE id SET is_cycle USING path
      SELECT id, title FROM chain WHERE NOT is_cycle ORDER BY level`,
  );
}

/** Number of levels in the subtree rooted at `goalId` (1 for a leaf). */
async function subtreeHeight(ctx: Ctx, goalId: string): Promise<number> {
  const [row] = await queryRows<{ height: number | string | null }>(
    ctx.db,
    sql`
      WITH RECURSIVE sub AS (
        SELECT id, 1 AS height FROM goals
        WHERE tenant_id = ${ctx.tenant.id} AND id = ${goalId}
        UNION ALL
        SELECT g.id, s.height + 1 FROM goals g
        JOIN sub s ON g.parent_id = s.id
        WHERE g.tenant_id = ${ctx.tenant.id}
      ) CYCLE id SET is_cycle USING path
      SELECT max(height) AS height FROM sub WHERE NOT is_cycle`,
  );
  return Number(row?.height ?? 1);
}

/** Validates placing `movingGoalId` (or a new goal) under `parentId`: same tenant, no cycle, depth limit. */
async function assertValidParent(ctx: Ctx, parentId: string, movingGoalId?: string): Promise<void> {
  await findGoal(ctx, parentId);
  const chain = await ancestorChain(ctx, parentId);
  if (movingGoalId && chain.some((goal) => goal.id === movingGoalId)) {
    throw conflict("A goal cannot be placed under itself or one of its own sub-goals.");
  }
  const height = movingGoalId ? await subtreeHeight(ctx, movingGoalId) : 1;
  if (chain.length + height > GOAL_MAX_DEPTH) {
    throw invalid(`Goals can be nested at most ${GOAL_MAX_DEPTH} levels deep.`);
  }
}

export async function taskCountsByGoal(ctx: Ctx): Promise<Map<string, TaskCounts>> {
  const rows = await ctx.db
    .select({ goalId: tasks.goalId, status: tasks.status, n: count() })
    .from(tasks)
    .where(and(eq(tasks.tenantId, ctx.tenant.id), isNotNull(tasks.goalId)))
    .groupBy(tasks.goalId, tasks.status);

  const counts = new Map<string, TaskCounts>();
  for (const { goalId, status, n } of rows) {
    if (!goalId) continue;
    const entry = counts.get(goalId) ?? { open: 0, done: 0, total: 0 };
    if (status === "done") entry.done += n;
    else if (status !== "dropped") entry.open += n;
    entry.total = entry.open + entry.done;
    counts.set(goalId, entry);
  }
  return counts;
}

/** Every goal in the tenant, depth-first, with roll-up progress. */
export async function allGoalsWithProgress(ctx: Ctx): Promise<GoalWithProgress[]> {
  const [rows, counts] = await Promise.all([
    ctx.db
      .select(goalColumns)
      .from(goals)
      .where(eq(goals.tenantId, ctx.tenant.id))
      .orderBy(asc(goals.createdAt)),
    taskCountsByGoal(ctx),
  ]);
  return withProgress(rows, counts);
}

export const listGoals = service(ListGoalsInput, async (ctx, { status }): Promise<GoalWithProgress[]> => {
  assertCan(ctx, "workspace:read");
  const all = await allGoalsWithProgress(ctx);
  return status ? all.filter((goal) => goal.status === status) : all;
});

export const createGoal = service(CreateGoalInput, async (ctx, input): Promise<Goal> => {
  assertCan(ctx, "goal:write");
  if (input.parentGoalId) await assertValidParent(ctx, input.parentGoalId);

  // Goals written by humans are approved by definition; agents can only propose.
  const byHuman = ctx.actor.type === "user";
  return inTransaction(ctx, async (tx) => {
    const [goal] = await tx.db
      .insert(goals)
      .values({
        id: newId("g"),
        tenantId: tx.tenant.id,
        parentId: input.parentGoalId ?? null,
        title: input.title,
        description: input.description,
        status: byHuman ? "active" : "proposed",
        approvedById: byHuman ? tx.actor.id : null,
        approvedByName: byHuman ? tx.actor.name : null,
        approvedAt: byHuman ? new Date() : null,
        ...createdByFields(tx.actor),
      })
      .returning(goalColumns);
    await recordEvent(tx, {
      action: byHuman ? "goal.created" : "goal.proposed",
      entityType: "goal",
      entityId: goal!.id,
      summary: `${byHuman ? "created" : "proposed"} goal "${goal!.title}"`,
      data: { parentGoalId: goal!.parentId },
    });
    return goal!;
  });
});

export const updateGoal = service(UpdateGoalInput, async (ctx, input): Promise<Goal> => {
  assertCan(ctx, "goal:write");
  const current = await findGoal(ctx, input.goalId);
  if (input.parentGoalId) await assertValidParent(ctx, input.parentGoalId, current.id);

  const patch = {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.parentGoalId !== undefined && { parentId: input.parentGoalId }),
  };
  const changed = Object.keys(patch);
  if (changed.length === 0) throw invalid("Nothing to update: pass title, description, or parentGoalId.");

  return inTransaction(ctx, async (tx) => {
    const [goal] = await tx.db
      .update(goals)
      .set(patch)
      .where(and(eq(goals.tenantId, tx.tenant.id), eq(goals.id, current.id)))
      .returning(goalColumns);
    await recordEvent(tx, {
      action: "goal.updated",
      entityType: "goal",
      entityId: current.id,
      summary: `updated goal "${goal!.title}" (${changed.join(", ")})`,
      data: { changed },
    });
    return goal!;
  });
});

function statusEvent(from: GoalStatus, to: GoalStatus): { action: EventAction; verb: string } {
  if (to === "active") {
    return from === "proposed"
      ? { action: "goal.approved", verb: "approved" }
      : { action: "goal.reactivated", verb: "reactivated" };
  }
  if (to === "achieved") return { action: "goal.achieved", verb: "marked achieved" };
  if (to === "abandoned") return { action: "goal.abandoned", verb: "abandoned" };
  return { action: "goal.updated", verb: `moved back to ${GOAL_STATUS_META[to].label.toLowerCase()}` };
}

export const setGoalStatus = service(SetGoalStatusInput, async (ctx, { goalId, status }): Promise<Goal> => {
  assertCan(ctx, "goal:decide");
  const current = await findGoal(ctx, goalId);
  if (current.status === status) return current;

  const approving = status === "active" && current.approvedAt === null;
  const { action, verb } = statusEvent(current.status, status);
  return inTransaction(ctx, async (tx) => {
    const [goal] = await tx.db
      .update(goals)
      .set({
        status,
        ...(approving && { approvedById: tx.actor.id, approvedByName: tx.actor.name, approvedAt: new Date() }),
      })
      .where(and(eq(goals.tenantId, tx.tenant.id), eq(goals.id, goalId)))
      .returning(goalColumns);
    await recordEvent(tx, {
      action,
      entityType: "goal",
      entityId: goalId,
      summary: `${verb} goal "${current.title}"`,
      data: { from: current.status, to: status },
    });
    return goal!;
  });
});
