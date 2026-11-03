import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import { isOpenTaskStatus, OPEN_TASK_STATUSES, SOURCE_META, TASK_STATUS_META } from "@/lib/domain";

import { patchOf, publicColumns } from "../db/columns";
import { newId } from "../db/ids";
import { agents, goals, tasks, type TaskRow } from "../db/schema";
import { createdByFields, inTenant, inTransaction, tenantRow, type Ctx } from "./context";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent, recordEvents } from "./events";
import { assertGoalsExist, findGoal } from "./goals";
import { assertCan } from "./policy";
import {
  AssignTasksInput,
  CaptureTasksInput,
  CompleteTaskInput,
  ListTasksInput,
  NextActionsInput,
  TaskDraft,
  TaskRefInput,
  UpdateTaskInput,
} from "./schemas";
import { service } from "./service";

export type Task = Omit<TaskRow, "tenantId" | "search">;
/** A task with the labels every list needs: its goal's title and who has claimed it. */
export type TaskView = Task & { goalTitle: string | null; claimedByName: string | null };

export const taskColumns = publicColumns(tasks, ["tenantId", "search"]);

/** Most urgent first: priority, then due date (undated last), then oldest. */
export const byUrgency: SQL[] = [
  sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
  sql`${tasks.dueDate} asc nulls last`,
  asc(tasks.createdAt),
];

const agentIdOf = (ctx: Ctx) => (ctx.actor.type === "agent" ? ctx.actor.id : null);

export const isOpenTask = inArray(tasks.status, [...OPEN_TASK_STATUSES]);
export const isOverdue = and(isOpenTask, sql`${tasks.dueDate} < current_date`)!;
export const isDueWithinWeek = and(
  isOpenTask,
  sql`${tasks.dueDate} between current_date and current_date + 7`,
)!;

/** Selects tenant tasks as `TaskView`s; callers add filters, ordering, and limits. */
export function selectTaskViews(ctx: Ctx, where?: SQL) {
  return ctx.db
    .select({ ...taskColumns, goalTitle: goals.title, claimedByName: agents.name })
    .from(tasks)
    .leftJoin(goals, and(eq(goals.tenantId, tasks.tenantId), eq(goals.id, tasks.goalId)))
    .leftJoin(agents, and(eq(agents.tenantId, tasks.tenantId), eq(agents.id, tasks.claimedByAgentId)))
    .where(and(inTenant(ctx, tasks), where));
}

export async function findTask(ctx: Ctx, taskId: string): Promise<Task> {
  const [task] = await ctx.db
    .select(taskColumns)
    .from(tasks)
    .where(tenantRow(ctx, tasks, taskId));
  if (!task) throw notFound("task", taskId);
  return task;
}

/** Agents must not change work another agent has claimed; humans may always step in. */
async function assertNotClaimedByOther(ctx: Ctx, task: Task): Promise<void> {
  const me = agentIdOf(ctx);
  if (!me || !task.claimedByAgentId || task.claimedByAgentId === me) return;
  const [claimant] = await ctx.db
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, task.claimedByAgentId));
  throw conflict(
    `"${task.title}" is claimed by ${claimant?.name ?? "another agent"}. ` +
      "Pick another task, or ask a human to release it.",
  );
}

export interface CaptureResult {
  created: Task[];
  duplicates: { title: string; source: string; sourceRef: string; existingTaskId: string | null }[];
}

export const captureTasks = service(CaptureTasksInput, (ctx, { tasks: drafts }) => capture(ctx, drafts));

/** One task entered by hand (the web app's quick add). */
export const addTask = service(TaskDraft, (ctx, draft) => capture(ctx, [draft]));

async function capture(ctx: Ctx, drafts: z.output<typeof TaskDraft>[]): Promise<CaptureResult> {
  assertCan(ctx, "task:write");
  await assertGoalsExist(ctx, drafts.flatMap((draft) => (draft.goalId ? [draft.goalId] : [])));

  const rows = drafts.map((draft) => ({
    ...draft,
    id: newId("t"),
    tenantId: ctx.tenant.id,
    dueDate: draft.dueDate ?? null,
    goalId: draft.goalId ?? null,
    ...createdByFields(ctx.actor),
  }));

  return inTransaction(ctx, async (tx) => {
    // The partial unique index on (tenant, source, source_ref) silently skips re-captures.
    const created = await tx.db.insert(tasks).values(rows).onConflictDoNothing().returning(taskColumns);
    const createdIds = new Set(created.map((task) => task.id));
    const skipped = rows.filter((row) => !createdIds.has(row.id));

    const existing = skipped.length
      ? await tx.db
          .select({ id: tasks.id, source: tasks.source, sourceRef: tasks.sourceRef })
          .from(tasks)
          .where(
            and(
              inTenant(tx, tasks),
              or(...skipped.map((row) => and(eq(tasks.source, row.source), eq(tasks.sourceRef, row.sourceRef)))),
            ),
          )
      : [];

    await recordEvents(
      tx,
      created.map((task) => ({
        action: "task.captured" as const,
        entityType: "task" as const,
        entityId: task.id,
        summary: `captured "${task.title}" from ${SOURCE_META[task.source].label.toLowerCase()}`,
        data: { goalId: task.goalId, source: task.source, status: task.status },
      })),
    );

    return {
      created,
      duplicates: skipped.map((row) => ({
        title: row.title,
        source: row.source,
        sourceRef: row.sourceRef,
        existingTaskId:
          existing.find((task) => task.source === row.source && task.sourceRef === row.sourceRef)?.id ?? null,
      })),
    };
  });
}

export const updateTask = service(UpdateTaskInput, async (ctx, input): Promise<Task> => {
  assertCan(ctx, "task:write");
  const { taskId, ...fields } = input;
  const current = await findTask(ctx, taskId);
  if (fields.goalId) await assertGoalsExist(ctx, [fields.goalId]);

  const patch: Partial<typeof tasks.$inferInsert> = patchOf(fields);
  const changed = Object.keys(patch);
  if (changed.length === 0) throw invalid("Nothing to update: pass at least one field to change.");

  const statusChange = fields.status !== undefined && fields.status !== current.status ? fields.status : null;
  if (statusChange) {
    await assertNotClaimedByOther(ctx, current);
    patch.completedAt = statusChange === "done" ? new Date() : null;
    // A claim only means "an agent is working on it right now".
    if (statusChange !== "in_progress") Object.assign(patch, { claimedByAgentId: null, claimedAt: null });
  }

  return inTransaction(ctx, async (tx) => {
    const [task] = await tx.db
      .update(tasks)
      .set(patch)
      .where(tenantRow(tx, tasks, current.id))
      .returning(taskColumns);
    await recordEvent(tx, {
      action: "task.updated",
      entityType: "task",
      entityId: current.id,
      summary: statusChange
        ? `moved "${task!.title}" to ${TASK_STATUS_META[statusChange].label}`
        : `updated "${task!.title}" (${changed.join(", ")})`,
      // The status lets the timeline replay where a task stood on each day.
      data: { changed, goalId: task!.goalId, ...(statusChange && { status: statusChange }) },
    });
    return task!;
  });
});

export const claimTask = service(TaskRefInput, async (ctx, { taskId }): Promise<Task> => {
  assertCan(ctx, "task:write");
  const me = agentIdOf(ctx);
  if (!me) throw invalid("Only agents claim tasks. Humans can move a task to In progress instead.");

  return inTransaction(ctx, async (tx) => {
    // One conditional UPDATE: concurrent claims cannot both succeed.
    const [task] = await tx.db
      .update(tasks)
      .set({ claimedByAgentId: me, claimedAt: new Date(), status: "in_progress" })
      .where(
        and(
          inTenant(tx, tasks),
          eq(tasks.id, taskId),
          isOpenTask,
          or(isNull(tasks.claimedByAgentId), eq(tasks.claimedByAgentId, me)),
        ),
      )
      .returning(taskColumns);

    if (!task) {
      const current = await findTask(tx, taskId);
      if (!isOpenTaskStatus(current.status)) {
        throw conflict(`"${current.title}" is already ${TASK_STATUS_META[current.status].label.toLowerCase()}.`);
      }
      await assertNotClaimedByOther(tx, current);
      throw conflict(`Could not claim "${current.title}".`);
    }

    await recordEvent(tx, {
      action: "task.claimed",
      entityType: "task",
      entityId: task.id,
      summary: `claimed "${task.title}"`,
      data: { goalId: task.goalId },
    });
    return task;
  });
});

export const releaseTask = service(TaskRefInput, async (ctx, { taskId }): Promise<Task> => {
  assertCan(ctx, "task:write");
  const current = await findTask(ctx, taskId);
  if (!current.claimedByAgentId) return current;
  await assertNotClaimedByOther(ctx, current);

  return inTransaction(ctx, async (tx) => {
    const [task] = await tx.db
      .update(tasks)
      .set({
        claimedByAgentId: null,
        claimedAt: null,
        status: current.status === "in_progress" ? "todo" : current.status,
      })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);
    await recordEvent(tx, {
      action: "task.released",
      entityType: "task",
      entityId: taskId,
      summary: `released "${current.title}"`,
      data: { goalId: current.goalId },
    });
    return task!;
  });
});

export const completeTask = service(CompleteTaskInput, async (ctx, { taskId, note }): Promise<Task> => {
  assertCan(ctx, "task:write");
  const current = await findTask(ctx, taskId);
  if (current.status === "done") return current;
  await assertNotClaimedByOther(ctx, current);

  const description = note
    ? `${current.description}\n\nCompletion note (${ctx.actor.name}): ${note}`.trim()
    : current.description;

  return inTransaction(ctx, async (tx) => {
    const [task] = await tx.db
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), claimedByAgentId: null, claimedAt: null, description })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);
    await recordEvent(tx, {
      action: "task.completed",
      entityType: "task",
      entityId: taskId,
      summary: `completed "${current.title}"`,
      data: { goalId: current.goalId, note },
    });
    return task!;
  });
});

export const assignTasksToGoal = service(AssignTasksInput, async (ctx, { taskIds, goalId }): Promise<Task[]> => {
  assertCan(ctx, "task:write");
  const goal = await findGoal(ctx, goalId);
  const ids = [...new Set(taskIds)];

  return inTransaction(ctx, async (tx) => {
    const updated = await tx.db
      .update(tasks)
      .set({
        goalId,
        // Filing an untriaged task under a goal is the triage step: inbox becomes todo.
        status: sql`case when ${tasks.status} = 'inbox' then 'todo'::task_status else ${tasks.status} end`,
      })
      .where(and(inTenant(tx, tasks), inArray(tasks.id, ids)))
      .returning(taskColumns);

    const missing = ids.find((id) => !updated.some((task) => task.id === id));
    if (missing) throw notFound("task", missing);

    await recordEvents(
      tx,
      updated.map((task) => ({
        action: "task.assigned" as const,
        entityType: "task" as const,
        entityId: task.id,
        summary: `filed "${task.title}" under "${goal.title}"`,
        data: { goalId },
      })),
    );
    return updated;
  });
});

export const listTasks = service(ListTasksInput, async (ctx, input): Promise<TaskView[]> => {
  assertCan(ctx, "workspace:read");
  const me = agentIdOf(ctx);
  const claimed = {
    any: undefined,
    mine: me ? eq(tasks.claimedByAgentId, me) : sql`false`,
    unclaimed: isNull(tasks.claimedByAgentId),
  }[input.claimed];
  const due = { any: undefined, overdue: isOverdue, next_7_days: isDueWithinWeek }[input.due];

  return selectTaskViews(
    ctx,
    and(
      input.status ? eq(tasks.status, input.status) : undefined,
      input.goalId ? eq(tasks.goalId, input.goalId) : undefined,
      input.priority ? eq(tasks.priority, input.priority) : undefined,
      claimed,
      due,
    ),
  )
    .orderBy(...byUrgency)
    .limit(input.limit);
});

export const suggestNextActions = service(NextActionsInput, async (ctx, { limit }): Promise<TaskView[]> => {
  assertCan(ctx, "workspace:read");
  const me = agentIdOf(ctx);
  return selectTaskViews(
    ctx,
    and(
      inArray(tasks.status, ["todo", "in_progress"]),
      // Agents should not be steered toward work another agent already holds.
      me ? or(isNull(tasks.claimedByAgentId), eq(tasks.claimedByAgentId, me)) : undefined,
    ),
  )
    .orderBy(...byUrgency)
    .limit(limit);
});
