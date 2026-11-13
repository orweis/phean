import { and, asc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import {
  chosenOption,
  chosenOptions,
  DELIVERED_OUTCOMES,
  MAX_ANSWERS,
  movesSession,
  withSession,
  type AgentSession,
  type InputAnswer,
  type InputRequest,
  type RequestOutcome,
  type TaskLink,
} from "@/lib/agent-sessions";
import { isOpenTaskStatus, OPEN_TASK_STATUSES, SOURCE_META, TASK_STATUS_META, type TaskStatus } from "@/lib/domain";
import type { DocumentRef } from "@/lib/documents";
import { isBuiltIn, stageLabel, type Stage } from "@/lib/workflow";
import { truncate } from "@/lib/format";

import { patchOf, publicColumns } from "../db/columns";
import { newId } from "../db/ids";
import { agents, goals, member, tasks, user, type TaskRow } from "../db/schema";
import { liveAgent } from "./agent-liveness";
import { createdByFields, inTenant, inTransaction, tenantRow, type Ctx } from "./context";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent, recordEvents, taskActivity, type Activity } from "./events";
import { assertGoalsExist, findGoal } from "./goals";
import { assertCan } from "./policy";
import { loadWorkflow } from "./workflow";
import {
  AnswerInput,
  RetractAnswerInput,
  AskInput,
  AssignTasksInput,
  CaptureTasksInput,
  ClaimTaskInput,
  CollectAnswersInput,
  CompleteTaskInput,
  DecisionsInput,
  HandOffChoiceInput,
  HandOffInput,
  LinkSessionInput,
  ListGoalTasksInput,
  ListTasksInput,
  NextActionsInput,
  ReleaseTaskInput,
  SessionInput,
  TaskDraft,
  TaskRefInput,
  Empty,
  UpdateTaskInput,
  WaitForAnswersInput,
} from "./schemas";
import { service } from "./service";

export type Task = Omit<TaskRow, "tenantId" | "search">;
/**
 * A task with the labels every list needs: its goal's title, who has claimed it, the task it is a
 * subtask of, and how many subtasks of its own are done.
 */
export type TaskView = Task & {
  goalTitle: string | null;
  claimedByName: string | null;
  /** Who is working on it right now: an agent (its claim) or a person, or null. */
  operatorType: "agent" | "user" | null;
  operatorName: string | null;
  /** Who a handoff is meant for, when it names someone. */
  delegateToName: string | null;
  parentTitle: string | null;
  subtaskCount: number;
  subtasksDone: number;
  /** Documents attached to the task, oldest first. */
  documents: DocumentRef[];
};

export const taskColumns = publicColumns(tasks, ["tenantId", "search"]);

/** Most urgent first: priority, then due date (undated last), then oldest. */
export const byUrgency: SQL[] = [
  sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
  sql`${tasks.dueDate} asc nulls last`,
  asc(tasks.createdAt),
];

const agentIdOf = (ctx: Ctx) => (ctx.actor.type === "agent" ? ctx.actor.id : null);

/** The acting agent's id, for operations only agents perform; `instead` tells a person what they do. */
function agentOnly(ctx: Ctx, instead: string): string {
  const me = agentIdOf(ctx);
  if (!me) throw invalid(instead);
  return me;
}

/** The acting person's id, for operations only people perform; `instead` tells an agent what it does. */
function userOnly(ctx: Ctx, instead: string): string {
  if (ctx.actor.type !== "user") throw invalid(instead);
  return ctx.actor.id;
}

/** Whether the acting agent or person is the task's operator. */
const operates = (ctx: Ctx, task: Pick<Task, "claimedByAgentId" | "operatorUserId">) =>
  ctx.actor.type === "agent" ? task.claimedByAgentId === ctx.actor.id : task.operatorUserId === ctx.actor.id;

/** No one working on it. */
const NO_OPERATOR = { claimedByAgentId: null, operatorUserId: null, claimedAt: null } as const;
/** No handover under way. */
const NO_DELEGATION = { delegation: null, delegateToAgentId: null, delegateToUserId: null, delegationNote: "", delegatedAt: null } as const;

/** A new operator's first step forward (a session, a question, an update) ends their pick-up. */
const settledBy = (ctx: Ctx, task: Task) => (task.delegation === "picking_up" && operates(ctx, task) ? NO_DELEGATION : {});

/** Tasks being handed to the actor by name, or to anyone, that they do not already operate. */
export function handedTo(ctx: Ctx): SQL {
  const named = ctx.actor.type === "agent" ? eq(tasks.delegateToAgentId, ctx.actor.id) : eq(tasks.delegateToUserId, ctx.actor.id);
  const theirs = ctx.actor.type === "agent" ? sql`${tasks.claimedByAgentId} is distinct from ${ctx.actor.id}` : sql`${tasks.operatorUserId} is distinct from ${ctx.actor.id}`;
  return and(eq(tasks.delegation, "handing_off"), or(named, and(isNull(tasks.delegateToAgentId), isNull(tasks.delegateToUserId))), theirs)!;
}

export const isOpenTask = inArray(tasks.status, [...OPEN_TASK_STATUSES]);
export const isOverdue = and(isOpenTask, sql`${tasks.dueDate} < current_date`)!;
export const isDueWithinWeek = and(
  isOpenTask,
  sql`${tasks.dueDate} between current_date and current_date + 7`,
)!;
export const isAwaitingInput = and(isOpenTask, isNotNull(tasks.inputRequest))!;

const parentTask = alias(tasks, "parent_task");
const operatorUser = alias(user, "operator_user");
const delegateAgent = alias(agents, "delegate_agent");
const delegateUser = alias(user, "delegate_user");

const subtaskTally = (filter: SQL) =>
  sql<number>`(select count(*)::int from tasks as sub where sub.tenant_id = ${tasks.tenantId} and sub.parent_task_id = ${tasks.id} and ${filter})`;

/** Selects tenant tasks as `TaskView`s; callers add filters, ordering, and limits. */
export function selectTaskViews(ctx: Ctx, where?: SQL) {
  return ctx.db
    .select({
      ...taskColumns,
      goalTitle: goals.title,
      claimedByName: agents.name,
      operatorType: sql<"agent" | "user" | null>`case when ${tasks.claimedByAgentId} is not null then 'agent' when ${tasks.operatorUserId} is not null then 'user' end`,
      operatorName: sql<string | null>`coalesce(${agents.name}, ${operatorUser.name})`,
      delegateToName: sql<string | null>`coalesce(${delegateAgent.name}, ${delegateUser.name})`,
      parentTitle: parentTask.title,
      // Dropped subtasks are not part of the work any more.
      subtaskCount: subtaskTally(sql`sub.status <> 'dropped'`),
      subtasksDone: subtaskTally(sql`sub.status = 'done'`),
      // What lists show of each attached document: enough to mark it and link to it.
      documents: sql<DocumentRef[]>`coalesce((select json_agg(json_build_object('id', doc.id, 'title', doc.title, 'format', doc.format) order by doc.created_at)
        from documents as doc where doc.tenant_id = ${tasks.tenantId} and doc.task_id = ${tasks.id}), '[]'::json)`,
    })
    .from(tasks)
    .leftJoin(goals, and(eq(goals.tenantId, tasks.tenantId), eq(goals.id, tasks.goalId)))
    .leftJoin(agents, and(eq(agents.tenantId, tasks.tenantId), eq(agents.id, tasks.claimedByAgentId)))
    .leftJoin(operatorUser, eq(operatorUser.id, tasks.operatorUserId))
    .leftJoin(delegateAgent, and(eq(delegateAgent.tenantId, tasks.tenantId), eq(delegateAgent.id, tasks.delegateToAgentId)))
    .leftJoin(delegateUser, eq(delegateUser.id, tasks.delegateToUserId))
    .leftJoin(parentTask, and(eq(parentTask.tenantId, tasks.tenantId), eq(parentTask.id, tasks.parentTaskId)))
    .where(and(inTenant(ctx, tasks), where));
}

/**
 * Checks that `parentId` can take `childId` (or new tasks) as a subtask: it exists in the tenant,
 * is not itself a subtask, and is not the task. A task that has subtasks cannot become one.
 */
async function assertValidParent(ctx: Ctx, parentId: string, childId?: string): Promise<Task> {
  if (parentId === childId) throw invalid("A task cannot be its own subtask.");
  const parent = await findTask(ctx, parentId);
  if (parent.parentTaskId) {
    throw invalid(`"${parent.title}" is already a subtask. Subtasks go one level deep: attach this to "${parent.parentTaskId}" instead.`);
  }
  if (childId) {
    const [child] = await ctx.db.select({ id: tasks.id }).from(tasks).where(and(inTenant(ctx, tasks), eq(tasks.parentTaskId, childId))).limit(1);
    if (child) throw invalid("This task has subtasks of its own, so it cannot become a subtask. Move its subtasks first.");
  }
  return parent;
}

/** Postgres' unique violation, however the driver wraps it. */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/** Applies addLinks and removeLinks to a task's links: added urls replace links with the same url. */
function mergedLinks(current: readonly TaskLink[], add: readonly TaskLink[] = [], remove: readonly string[] = []): TaskLink[] {
  const normalized = normalizeLinks(add);
  const removed = new Set(remove.map((url) => { try { return new URL(url).href; } catch { return url; } }));
  const added = new Set(normalized.map((link) => link.url));
  return [...current.filter((link) => !removed.has(link.url) && !added.has(link.url)), ...normalized];
}

/** With `lock`, holds the row until the transaction ends, for read-modify-write updates. */
export async function findTask(ctx: Ctx, taskId: string, { lock = false } = {}): Promise<Task> {
  const query = ctx.db
    .select(taskColumns)
    .from(tasks)
    .where(tenantRow(ctx, tasks, taskId));
  const [task] = await (lock ? query.for("update") : query);
  if (!task) throw notFound("task", taskId);
  return task;
}

function sessionOf(ctx: Ctx, input: z.output<typeof SessionInput>): AgentSession {
  return {
    agentId: ctx.actor.id,
    agentName: ctx.actor.name,
    app: input.app || null,
    // Stored as the browser will read it, so the scheme that was checked is the one clicked.
    url: input.url ? new URL(input.url).href : null,
    sessionId: input.sessionId || null,
    messageId: input.messageId || null,
    command: input.command || null,
    brief: input.brief,
    linkedAt: new Date().toISOString(),
  };
}

/** Links as the browser will read them, so the scheme that was checked is the one clicked. */
const normalizeLinks = (links: readonly TaskLink[]): TaskLink[] =>
  links.map(({ url, title, kind }) => ({ url: new URL(url).href, title, kind }));

interface Closing {
  outcome: RequestOutcome;
  answer?: string;
  choices?: string[];
  answeredByName?: string | null;
}

/** A request as it is kept once closed. Only what a person decided waits for the agent to collect. */
function closed(request: InputRequest, { outcome, answer = "", choices, answeredByName = null }: Closing): InputAnswer {
  return {
    ...request,
    outcome,
    answer,
    ...(choices && { choices }),
    answeredByName,
    closedAt: new Date().toISOString(),
    collected: !DELIVERED_OUTCOMES.includes(outcome),
  };
}

const withAnswer = (answers: readonly InputAnswer[], answer: InputAnswer): InputAnswer[] => [answer, ...answers].slice(0, MAX_ANSWERS);

/**
 * Closes the open request in SQL, for updates that do not read the row first: the task moved on
 * (completed, released, out of progress), so the question is archived as "closed". Every SET
 * expression reads the row as it was, so this pairs with `inputRequest: null`.
 */
const archiveOpenRequest = () => {
  const closing = JSON.stringify({ outcome: "closed", answer: "", answeredByName: null, closedAt: new Date().toISOString(), collected: true });
  return sql`case when ${tasks.inputRequest} is null then ${tasks.inputAnswers}
    else jsonb_path_query_array(jsonb_build_array(${tasks.inputRequest} || ${closing}::jsonb) || ${tasks.inputAnswers}, ${`$[0 to ${MAX_ANSWERS - 1}]`}::jsonpath) end`;
};

/** Clears a task's open question, keeping it in the task's answer history. */
const closeOpenRequest = () => ({ inputRequest: null, inputAnswers: archiveOpenRequest() });

/** What the activity log keeps of a session: enough to find the conversation again. */
const sessionData = ({ app, url, sessionId }: AgentSession) => ({ app, url, sessionId });

/** The name of whoever works on a task, for messages. */
async function operatorName(ctx: Ctx, task: Pick<Task, "claimedByAgentId" | "operatorUserId">): Promise<string> {
  if (task.claimedByAgentId) {
    const [row] = await ctx.db.select({ name: agents.name }).from(agents).where(and(inTenant(ctx, agents), eq(agents.id, task.claimedByAgentId)));
    return row?.name ?? "another agent";
  }
  if (task.operatorUserId) {
    const [row] = await ctx.db.select({ name: user.name }).from(user).where(eq(user.id, task.operatorUserId));
    return row?.name ?? "someone";
  }
  return "no one";
}

/**
 * Agents must not change work another operator (an agent's claim, or a person working on it) holds;
 * people may always step in.
 */
async function assertNotClaimedByOther(ctx: Ctx, task: Task): Promise<void> {
  const me = agentIdOf(ctx);
  if (!me || operates(ctx, task) || (!task.claimedByAgentId && !task.operatorUserId)) return;
  const who = await operatorName(ctx, task);
  throw conflict(
    task.claimedByAgentId
      ? `"${task.title}" is claimed by ${who}. Pick another task, or ask a human to release it.`
      : `"${task.title}" is being worked on by ${who}. Pick another task, or ask them to hand it off to you.`,
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
  const parents = new Map<string, Task>();
  for (const parentId of new Set(drafts.flatMap((draft) => (draft.parentTaskId ? [draft.parentTaskId] : [])))) {
    parents.set(parentId, await assertValidParent(ctx, parentId));
  }

  const rows = drafts.map((draft) => ({
    ...draft,
    id: newId("t"),
    tenantId: ctx.tenant.id,
    dueDate: draft.dueDate ?? null,
    // A subtask belongs to its parent's goal unless it says otherwise.
    goalId: draft.goalId ?? (draft.parentTaskId ? parents.get(draft.parentTaskId)!.goalId : null),
    parentTaskId: draft.parentTaskId ?? null,
    links: normalizeLinks(draft.links),
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
        summary: task.source === "manual" ? `added "${task.title}" by hand` : `captured "${task.title}" from ${SOURCE_META[task.source].label.toLowerCase()}`,
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

/**
 * Resolves a requested stage and status into what the task stores: a stage sets the status to its
 * kind (and is kept only when it is not the kind's own stage); a new status alone leaves any stage
 * of the old one.
 */
function placement(workflow: readonly Stage[], current: Task, status: TaskStatus | undefined, stage: string | null | undefined) {
  if (stage === undefined) return { status, stage: status !== undefined && status !== current.status ? null : undefined };
  if (stage === null) return { status, stage: null };
  const target = workflow.find((candidate) => candidate.key === stage);
  if (!target) throw invalid(`There is no stage "${stage}" in this workspace. whoami lists its stages.`);
  if (status !== undefined && status !== target.kind) throw invalid(`The "${target.label}" stage is a ${target.kind} stage, so it cannot go with status "${status}".`);
  return { status: target.kind, stage: isBuiltIn(target) ? null : target.key };
}

export const updateTask = service(UpdateTaskInput, async (ctx, input): Promise<Task> => {
  assertCan(ctx, "task:write");
  const { taskId, addLinks, removeLinks, ...requested } = input;
  const current0 = await findTask(ctx, taskId);
  const workflow = requested.stage !== undefined || requested.status !== undefined ? await loadWorkflow(ctx) : [];
  const placed = placement(workflow, current0, requested.status, requested.stage);
  const fields = { ...requested, status: placed.status, stage: placed.stage === current0.stage ? undefined : placed.stage };
  if (fields.links && (addLinks || removeLinks)) throw invalid("Pass links to replace them all, or addLinks and removeLinks to change some, not both.");
  const current = current0;
  if (fields.goalId) await assertGoalsExist(ctx, [fields.goalId]);
  if (fields.parentTaskId) await assertValidParent(ctx, fields.parentTaskId, current.id);

  const links = fields.links ? normalizeLinks(fields.links) : addLinks || removeLinks ? mergedLinks(current.links, addLinks, removeLinks) : undefined;
  const patch: Partial<typeof tasks.$inferInsert> = patchOf({ ...fields, links });
  const changed = Object.keys(patch);
  if (changed.length === 0) throw invalid("Nothing to update: pass at least one field to change.");

  const statusChange = fields.status !== undefined && fields.status !== current.status ? fields.status : null;
  const moved = statusChange !== null || fields.stage !== undefined;
  if (statusChange) {
    await assertNotClaimedByOther(ctx, current);
    patch.completedAt = statusChange === "done" ? new Date() : null;
    // Archiving files finished work away; work that moves again is back on the board.
    patch.archivedAt = null;
    // An operator only means "working on it right now"; their open question goes with them.
    if (statusChange !== "in_progress") Object.assign(patch, { ...NO_OPERATOR, ...closeOpenRequest() });
    // Finished work has no handover left, and a pick-up ends with any move.
    if (statusChange === "done" || statusChange === "dropped" || current.delegation === "picking_up") Object.assign(patch, NO_DELEGATION);
  }
  Object.assign(patch, settledBy(ctx, current));

  return inTransaction(ctx, async (tx) => {
    const [task] = await tx.db
      .update(tasks)
      .set(patch)
      .where(tenantRow(tx, tasks, current.id))
      .returning(taskColumns)
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) throw conflict(`Another task already tracks ${fields.source ?? current.source} "${fields.sourceRef ?? current.sourceRef}". Update that task instead.`);
        throw error;
      });
    await recordEvent(tx, {
      action: "task.updated",
      entityType: "task",
      entityId: current.id,
      summary: moved
        ? `moved "${task!.title}" to ${stageLabel(workflow, task!)}`
        : `updated "${task!.title}" (${changed.join(", ")})`,
      // The status lets the timeline replay where a task stood on each day.
      data: { changed, goalId: task!.goalId, ...(statusChange && { status: statusChange }), ...(moved && { stage: task!.stage }) },
    });
    return task!;
  });
});

export const claimTask = service(ClaimTaskInput, async (ctx, { taskId, session }): Promise<Task> => {
  assertCan(ctx, "task:write");
  const me = agentOnly(ctx, "Only agents claim tasks. People take a task from its menu instead.");
  const linked = session && sessionOf(ctx, session);

  return inTransaction(ctx, async (tx) => {
    // The row stays locked until the claim commits, so concurrent claims cannot both succeed.
    const current = await findTask(tx, taskId, { lock: true });
    if (!isOpenTaskStatus(current.status)) {
      throw conflict(`"${current.title}" is already ${TASK_STATUS_META[current.status].label.toLowerCase()}.`);
    }
    const mine = current.claimedByAgentId === me;
    const offered = current.delegation === "handing_off" && !mine;
    const forMe = offered && (current.delegateToAgentId === me || (!current.delegateToAgentId && !current.delegateToUserId));
    if (offered && !forMe) {
      const [target] = await selectTaskViews(tx, eq(tasks.id, taskId));
      throw conflict(`"${current.title}" is being handed off to ${target?.delegateToName ?? "someone else"}. Pick another task.`);
    }
    // A task handed to this agent is its to take, whoever holds it until then.
    if (!forMe) await assertNotClaimedByOther(tx, current);
    const pickingUp = forMe || current.delegation === "returned";

    const [task] = await tx.db
      .update(tasks)
      .set({
        claimedByAgentId: me,
        operatorUserId: null,
        claimedAt: mine ? current.claimedAt : new Date(),
        status: "in_progress",
        // A task already in one of the workspace's in-progress stages ("Review") stays in it.
        stage: current.status === "in_progress" ? current.stage : null,
        ...(linked && { agentSessions: withSession(current.agentSessions, linked) }),
        ...(pickingUp && { delegation: "picking_up" as const, delegateToAgentId: null, delegateToUserId: null, delegatedAt: new Date() }),
      })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);

    await recordEvent(tx, {
      action: pickingUp ? "task.picked_up" : "task.claimed",
      entityType: "task",
      entityId: taskId,
      summary: pickingUp ? `picked up "${current.title}"` : `claimed "${current.title}"`,
      data: {
        goalId: current.goalId,
        ...(pickingUp && { fromAgentId: current.claimedByAgentId, fromUserId: current.operatorUserId }),
        ...(linked && { session: sessionData(linked) }),
      },
    });
    return task!;
  });
});

/** A person takes a task on as its operator: starting it, picking up a handoff, or stepping in for an agent. */
export const takeTask = service(TaskRefInput, async (ctx, { taskId }): Promise<Task> => {
  assertCan(ctx, "task:write");
  const me = userOnly(ctx, "Agents take a task with claim_task.");

  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    if (!isOpenTaskStatus(current.status)) {
      throw conflict(`"${current.title}" is already ${TASK_STATUS_META[current.status].label.toLowerCase()}.`);
    }
    const mine = current.operatorUserId === me;
    if (mine && current.status === "in_progress" && current.delegation !== "handing_off") return current;
    // Taking over from someone, or taking a handoff, starts with getting up to speed.
    const pickingUp = !mine && (current.delegation === "handing_off" || current.delegation === "returned" || Boolean(current.claimedByAgentId || current.operatorUserId));

    const [task] = await tx.db
      .update(tasks)
      .set({
        claimedByAgentId: null,
        operatorUserId: me,
        claimedAt: mine ? current.claimedAt : new Date(),
        status: "in_progress",
        stage: current.status === "in_progress" ? current.stage : null,
        // An agent stepped away from has no one left to act on its question.
        ...(current.claimedByAgentId && closeOpenRequest()),
        ...(pickingUp ? { delegation: "picking_up" as const, delegateToAgentId: null, delegateToUserId: null, delegatedAt: new Date() } : NO_DELEGATION),
      })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);

    await recordEvent(tx, {
      action: pickingUp ? "task.picked_up" : "task.claimed",
      entityType: "task",
      entityId: taskId,
      summary: pickingUp ? `picked up "${current.title}"` : `started "${current.title}"`,
      data: { goalId: current.goalId, ...(pickingUp && { fromAgentId: current.claimedByAgentId, fromUserId: current.operatorUserId }) },
    });
    return task!;
  });
});

/** Who a handoff is for, found in this workspace: a live agent by id or name, or a member by user id or email. */
async function handoffTarget(ctx: Ctx, toAgent?: string, toPerson?: string): Promise<{ agentId: string | null; userId: string | null; name: string } | null> {
  if (toAgent) {
    const [byId] = await ctx.db.select({ id: agents.id, name: agents.name }).from(agents).where(and(inTenant(ctx, agents), eq(agents.id, toAgent), liveAgent()));
    if (byId) return { agentId: byId.id, userId: null, name: byId.name };
    const named = await ctx.db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(inTenant(ctx, agents), sql`lower(${agents.name}) = lower(${toAgent})`, liveAgent()))
      .orderBy(asc(agents.createdAt))
      .limit(5);
    if (named.length === 0) throw notFound("connected agent named or with id", toAgent);
    // Two agents can share a name (under different parents, say); a handoff must reach the one meant.
    if (named.length > 1) {
      throw invalid(`${named.length > 4 ? "Several" : named.length} connected agents are named "${toAgent}" (${named.map((agent) => agent.id).join(", ")}). Pass toAgent as the id of the one you mean.`);
    }
    return { agentId: named[0]!.id, userId: null, name: named[0]!.name };
  }
  if (toPerson) {
    const [person] = await ctx.db
      .select({ id: user.id, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, ctx.tenant.id), or(eq(user.id, toPerson), sql`lower(${user.email}) = lower(${toPerson})`)))
      .limit(1);
    if (!person) throw notFound("member with email or user id", toPerson);
    return { agentId: null, userId: person.id, name: person.name };
  }
  return null;
}

/**
 * Hands a task on: to a named agent or person, or to anyone. It stays with its operator until
 * someone picks it up. Its operator may hand it off, and so may a person or, for a task no one
 * works on, any agent that may write.
 */
export const handOffTask = service(HandOffInput, async (ctx, { taskId, toAgent, toPerson, note }): Promise<Task> => {
  assertCan(ctx, "task:write");

  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    if (!isOpenTaskStatus(current.status)) {
      throw conflict(`"${current.title}" is already ${TASK_STATUS_META[current.status].label.toLowerCase()}. Capture a new task for follow-up work.`);
    }
    await assertNotClaimedByOther(tx, current);
    const target = await handoffTarget(tx, toAgent, toPerson);
    if (target && (target.agentId ?? target.userId) === ctx.actor.id) throw invalid("You cannot hand a task to yourself.");
    if (target && ((target.agentId && target.agentId === current.claimedByAgentId) || (target.userId && target.userId === current.operatorUserId))) {
      throw invalid(`${target.name} is already working on "${current.title}".`);
    }

    const [task] = await tx.db
      .update(tasks)
      .set({ delegation: "handing_off", delegateToAgentId: target?.agentId ?? null, delegateToUserId: target?.userId ?? null, delegationNote: note, delegatedAt: new Date() })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);
    await recordEvent(tx, {
      action: "task.handed_off",
      entityType: "task",
      entityId: taskId,
      summary: `is handing off "${current.title}" to ${target?.name ?? "anyone"}`,
      data: { goalId: current.goalId, toAgentId: target?.agentId ?? null, toUserId: target?.userId ?? null, toName: target?.name ?? null, ...(note && { note }) },
    });
    return task!;
  });
});

/** The same handoff from the web form, where one choice names an agent, a person, or anyone. */
export const handOffTaskByChoice = service(HandOffChoiceInput, (ctx, { to, ...rest }) =>
  handOffTask(ctx, {
    ...rest,
    ...(to.startsWith("agent:") && { toAgent: to.slice("agent:".length) }),
    ...(to.startsWith("person:") && { toPerson: to.slice("person:".length) }),
  }),
);

/** Calls a handoff off: the task stays with its operator, or with no one. */
export const cancelHandOff = service(TaskRefInput, async (ctx, { taskId }): Promise<Task> => {
  assertCan(ctx, "task:write");

  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    if (current.delegation !== "handing_off") return current;
    await assertNotClaimedByOther(tx, current);
    const [task] = await tx.db.update(tasks).set(NO_DELEGATION).where(tenantRow(tx, tasks, taskId)).returning(taskColumns);
    await recordEvent(tx, {
      action: "task.handoff_cancelled",
      entityType: "task",
      entityId: taskId,
      summary: `called off the handoff of "${current.title}"`,
      data: { goalId: current.goalId },
    });
    return task!;
  });
});

/** An agent's session on a task, refreshed in place: one per agent, newest first. */
export const linkSession = service(LinkSessionInput, async (ctx, { taskId, session }): Promise<Task> => {
  assertCan(ctx, "task:write");
  const me = agentOnly(ctx, "Only agents link their sessions to tasks.");
  const next = sessionOf(ctx, session);

  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    await assertNotClaimedByOther(tx, current);
    const [task] = await tx.db
      .update(tasks)
      .set({ agentSessions: withSession(current.agentSessions, next), ...settledBy(tx, current) })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);
    // Refreshing the brief or the message is routine; only a new place to resume is news.
    if (movesSession(current.agentSessions.find((existing) => existing.agentId === me), next)) {
      await recordEvent(tx, {
        action: "task.session_linked",
        entityType: "task",
        entityId: taskId,
        summary: `linked a session to "${current.title}"`,
        data: { goalId: current.goalId, session: sessionData(next) },
      });
    }
    return task!;
  });
});

/** An agent's question for a person; the task shows as waiting on them until it is answered. */
export const requestInput = service(AskInput, async (ctx, { taskId, question, kind, context, options, multiple, links, session }): Promise<Task> => {
  assertCan(ctx, "task:write");
  const me = agentOnly(ctx, "Only agents ask for input. People can add a note to the task instead.");
  const choices = [...new Set(options)];
  if (multiple && choices.length < 2) throw invalid("A request that takes several answers needs at least two distinct options.");
  const next = session && sessionOf(ctx, session);

  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    if (!isOpenTaskStatus(current.status)) {
      throw conflict(`"${current.title}" is already ${TASK_STATUS_META[current.status].label.toLowerCase()}. Capture a new task for follow-up work.`);
    }
    await assertNotClaimedByOther(tx, current);
    const open = current.inputRequest;
    if (open && open.agentId !== me) {
      throw conflict(`"${current.title}" already waits on ${open.agentName}'s question. Wait until it is answered.`);
    }

    // A sub-agent asks in its own name; people also see the agent it works for.
    const parent = alias(agents, "parent");
    const [via] = await tx.db
      .select({ name: parent.name })
      .from(agents)
      .innerJoin(parent, eq(parent.id, agents.parentAgentId))
      .where(and(inTenant(tx, agents), eq(agents.id, me)));
    const inputRequest: InputRequest = {
      id: newId("q"),
      ...(via && { viaAgentName: via.name }),
      kind,
      question,
      context,
      options: choices,
      ...(multiple && { multiple: true }),
      links: normalizeLinks(links),
      agentId: me,
      agentName: ctx.actor.name,
      askedAt: new Date().toISOString(),
    };
    // Asking again replaces the agent's own open question; the earlier one is kept as resolved.
    const inputAnswers = open ? withAnswer(current.inputAnswers, closed(open, { outcome: "resolved" })) : current.inputAnswers;
    const [task] = await tx.db
      .update(tasks)
      .set({ inputRequest, inputAnswers, ...(next && { agentSessions: withSession(current.agentSessions, next) }), ...settledBy(tx, current) })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);
    await recordEvent(tx, {
      action: "task.input_requested",
      entityType: "task",
      entityId: taskId,
      summary: `${kind === "decision" ? "asked for a decision on" : "asked about"} "${current.title}": ${truncate(question, 120)}`,
      data: { goalId: current.goalId, requestId: inputRequest.id, kind, question, ...(multiple && { multiple: true }), ...(next && { session: sessionData(next) }) },
    });
    return task!;
  });
});

/** The asking agent closes its question once it has what it needed. */
export const resolveInput = service(TaskRefInput, async (ctx, { taskId }): Promise<Task> => {
  assertCan(ctx, "task:write");
  const me = agentOnly(ctx, "People mark an agent's question answered from the task in Phean.");

  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    const open = current.inputRequest;
    if (!open) return current;
    if (open.agentId !== me) {
      throw conflict(`The open question on "${current.title}" is ${open.agentName}'s. Only they, or a person, can close it.`);
    }
    const [task] = await tx.db
      .update(tasks)
      .set({ inputRequest: null, inputAnswers: withAnswer(current.inputAnswers, closed(open, { outcome: "resolved" })) })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);
    await recordEvent(tx, {
      action: "task.input_resolved",
      entityType: "task",
      entityId: taskId,
      summary: `closed its question on "${current.title}"`,
      data: { goalId: current.goalId, question: open.question },
    });
    return task!;
  });
});

/**
 * A person answers an agent's question from Phean, or marks it answered in the agent's own
 * conversation. A written answer is appended to the task, where the agent reads it next time.
 */
export const answerInput = service(AnswerInput, async (ctx, { taskId, answer: written, choices }): Promise<Task> => {
  assertCan(ctx, "task:write");
  if (agentIdOf(ctx)) throw invalid("Agents close their own questions with resolve_input.");

  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    const open = current.inputRequest;
    if (!open) {
      if (!written && !choices.length) return current;
      throw conflict(`There is no open question on "${current.title}" any more.`);
    }
    const picked = pickedOptions(open, choices);
    // Ticked options read as one answer, with anything written after them.
    const answer = picked ? [...picked, ...(written ? [written] : [])].join("; ") : written;
    const description = answer ? `${current.description}\n\n${answerNote(open, answer, ctx.actor.name)}`.trim() : current.description;
    const record = closed(open, { outcome: answer ? "answered" : "answered_elsewhere", answer, choices: picked, answeredByName: ctx.actor.name });
    const [task] = await tx.db
      .update(tasks)
      .set({ inputRequest: null, inputAnswers: withAnswer(current.inputAnswers, record), description })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);
    await recordEvent(tx, {
      action: "task.input_answered",
      entityType: "task",
      entityId: taskId,
      summary: answer ? `answered ${open.agentName} on "${current.title}"` : `marked ${open.agentName}'s question on "${current.title}" answered`,
      data: { goalId: current.goalId, agentId: open.agentId, requestId: open.id, kind: open.kind, question: open.question, answer, ...(picked && { choices: picked }) },
    });
    return task!;
  });
});

/** The options ticked on a request that takes several, in the order the agent gave them. */
function pickedOptions(request: InputRequest, positions: readonly number[]): string[] | undefined {
  if (!positions.length) return undefined;
  if (!request.multiple) throw invalid(`${request.agentName} asked for one answer. Pick one option, or write your answer.`);
  const wanted = new Set(positions);
  if ([...wanted].some((position) => position >= request.options.length)) throw invalid("That option is not on the request any more.");
  return request.options.filter((_, position) => wanted.has(position));
}

/** The note `answerInput` appends to the description, so taking the answer back can remove it. */
function answerNote(request: InputRequest, answer: string, by: string): string {
  return `${request.kind === "decision" ? "Decision asked by" : "Question from"} ${request.agentName}: ${request.question}\nAnswer from ${by}: ${answer}`;
}

/**
 * A person takes back the answer they just gave (Undo), while the asking agent has not collected
 * it: the question opens again exactly as it was asked, and the note on the task goes. Once the
 * agent has the answer it is too late; the person answers again in the agent's conversation.
 */
export const retractAnswer = service(RetractAnswerInput, async (ctx, { taskId, requestId }): Promise<Task> => {
  assertCan(ctx, "task:write");
  if (agentIdOf(ctx)) throw invalid("Only the person who answered can take an answer back.");

  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    const record = current.inputAnswers.find((entry) => entry.id === requestId);
    if (!record || !DELIVERED_OUTCOMES.includes(record.outcome)) throw notFound("answer", requestId);
    if (record.collected) throw conflict(`${record.agentName} already has that answer. Tell them in their conversation if it changed.`);
    if (current.inputRequest) throw conflict(`"${current.title}" has a newer question open, so the earlier answer stays.`);
    if (!isOpenTaskStatus(current.status)) throw conflict(`"${current.title}" has moved on, so its question stays answered.`);

    const { answer, answeredByName } = record;
    const request: InputRequest = {
      id: record.id,
      kind: record.kind,
      question: record.question,
      context: record.context,
      options: record.options,
      ...(record.multiple && { multiple: true }),
      ...(record.viaAgentName && { viaAgentName: record.viaAgentName }),
      links: record.links,
      agentId: record.agentId,
      agentName: record.agentName,
      askedAt: record.askedAt,
    };
    const note = answer ? answerNote(request, answer, answeredByName ?? "") : "";
    const description = note && current.description.endsWith(note) ? current.description.slice(0, -note.length).trimEnd() : current.description;
    const [task] = await tx.db
      .update(tasks)
      .set({ inputRequest: request, inputAnswers: current.inputAnswers.filter((entry) => entry !== record), description })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);
    await recordEvent(tx, {
      action: "task.input_retracted",
      entityType: "task",
      entityId: taskId,
      summary: `took back the answer to ${request.agentName} on "${current.title}"`,
      data: { goalId: current.goalId, agentId: request.agentId, requestId: request.id, kind: request.kind, question: request.question },
    });
    return task!;
  });
});

/**
 * Files a finished (done or dropped) task away: off the board's Done lane and agents' default task
 * list, but kept with its history, so goal progress, charts and search still count it. Reopening
 * the task, or `unarchiveTask`, brings it back.
 */
export const archiveTask = service(TaskRefInput, async (ctx, { taskId }): Promise<Task> => {
  assertCan(ctx, "task:write");
  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    if (isOpenTaskStatus(current.status)) throw conflict(`"${current.title}" is still open. Only done or dropped tasks are archived.`);
    if (current.archivedAt) return current;
    const [task] = await tx.db.update(tasks).set({ archivedAt: new Date() }).where(tenantRow(tx, tasks, taskId)).returning(taskColumns);
    await recordEvent(tx, { action: "task.archived", entityType: "task", entityId: taskId, summary: `archived "${current.title}"`, data: { goalId: current.goalId } });
    return task!;
  });
});

export const unarchiveTask = service(TaskRefInput, async (ctx, { taskId }): Promise<Task> => {
  assertCan(ctx, "task:write");
  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    if (!current.archivedAt) return current;
    const [task] = await tx.db.update(tasks).set({ archivedAt: null }).where(tenantRow(tx, tasks, taskId)).returning(taskColumns);
    await recordEvent(tx, { action: "task.unarchived", entityType: "task", entityId: taskId, summary: `unarchived "${current.title}"`, data: { goalId: current.goalId } });
    return task!;
  });
});

/** Archives every done task in the workspace at once: the board's Done lane, cleared. */
export const archiveDoneTasks = service(Empty, async (ctx): Promise<{ archived: number }> => {
  assertCan(ctx, "task:write");
  return inTransaction(ctx, async (tx) => {
    const archived = await tx.db
      .update(tasks)
      .set({ archivedAt: new Date() })
      .where(and(inTenant(tx, tasks), eq(tasks.status, "done"), isNull(tasks.archivedAt)))
      .returning({ id: tasks.id, title: tasks.title, goalId: tasks.goalId });
    await recordEvents(
      tx,
      archived.map((task) => ({ action: "task.archived", entityType: "task", entityId: task.id, summary: `archived "${task.title}"`, data: { goalId: task.goalId } })),
    );
    return { archived: archived.length };
  });
});

/** The operator lets a task go, with a note for whoever takes it next; it waits, returned, for a new operator. */
export const releaseTask = service(ReleaseTaskInput, async (ctx, { taskId, note }): Promise<Task> => {
  assertCan(ctx, "task:write");
  const current = await findTask(ctx, taskId);
  if (!current.claimedByAgentId && !current.operatorUserId) return current;
  await assertNotClaimedByOther(ctx, current);

  return inTransaction(ctx, async (tx) => {
    const [task] = await tx.db
      .update(tasks)
      .set({
        ...NO_OPERATOR,
        ...closeOpenRequest(),
        status: current.status === "in_progress" ? "todo" : current.status,
        stage: current.status === "in_progress" ? null : current.stage,
        ...NO_DELEGATION,
        delegation: "returned",
        delegationNote: note,
        delegatedAt: new Date(),
      })
      .where(tenantRow(tx, tasks, taskId))
      .returning(taskColumns);
    await recordEvent(tx, {
      action: "task.released",
      entityType: "task",
      entityId: taskId,
      summary: `released "${current.title}"`,
      data: { goalId: current.goalId, fromAgentId: current.claimedByAgentId, fromUserId: current.operatorUserId, ...(note && { note }) },
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
      .set({ status: "done", stage: null, completedAt: new Date(), ...NO_OPERATOR, ...NO_DELEGATION, ...closeOpenRequest(), description })
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
  const claimed = {
    any: undefined,
    mine: ctx.actor.type === "agent" ? eq(tasks.claimedByAgentId, ctx.actor.id) : eq(tasks.operatorUserId, ctx.actor.id),
    unclaimed: and(isNull(tasks.claimedByAgentId), isNull(tasks.operatorUserId)),
    handed_to_me: handedTo(ctx),
  }[input.claimed];
  const due = { any: undefined, overdue: isOverdue, next_7_days: isDueWithinWeek }[input.due];

  return selectTaskViews(
    ctx,
    and(
      input.status ? eq(tasks.status, input.status) : undefined,
      input.goalId ? eq(tasks.goalId, input.goalId) : undefined,
      input.parentTaskId ? eq(tasks.parentTaskId, input.parentTaskId) : undefined,
      input.priority ? eq(tasks.priority, input.priority) : undefined,
      input.includeArchived ? undefined : isNull(tasks.archivedAt),
      claimed,
      due,
    ),
  )
    .orderBy(...byUrgency)
    .limit(input.limit);
});

/**
 * Open tasks in a handover, for the overview: the ones being handed to the viewer (by name, or to
 * anyone) first, then the longest waiting.
 */
export const listHandoffs = service(Empty, async (ctx): Promise<TaskView[]> => {
  assertCan(ctx, "workspace:read");
  return selectTaskViews(ctx, and(isOpenTask, isNotNull(tasks.delegation), isNull(tasks.archivedAt)))
    .orderBy(sql`case when ${handedTo(ctx)} then 0 else 1 end`, asc(tasks.delegatedAt))
    .limit(20);
});

/** Every task filed under a goal, not dropped and not archived, most urgent first: what the Goals page peeks into. */
export const listGoalTasks = service(ListGoalTasksInput, async (ctx): Promise<TaskView[]> => {
  assertCan(ctx, "workspace:read");
  return selectTaskViews(ctx, and(isNotNull(tasks.goalId), isNull(tasks.archivedAt), sql`${tasks.status} <> 'dropped'`)).orderBy(...byUrgency);
});

export const suggestNextActions = service(NextActionsInput, async (ctx, { limit }): Promise<TaskView[]> => {
  assertCan(ctx, "workspace:read");
  const me = agentIdOf(ctx);
  return selectTaskViews(
    ctx,
    and(
      inArray(tasks.status, ["todo", "in_progress"]),
      // Agents should not be steered toward work another operator holds, or work waiting on a person,
      // unless it is being handed to them.
      me
        ? and(
            isNull(tasks.inputRequest),
            or(and(isNull(tasks.claimedByAgentId), isNull(tasks.operatorUserId), sql`${tasks.delegation} is distinct from 'handing_off'`), eq(tasks.claimedByAgentId, me), handedTo(ctx)),
          )
        : undefined,
    ),
  )
    // Work handed to the agent comes first: someone is waiting for it to be picked up.
    .orderBy(...(me ? [sql`case when ${handedTo(ctx)} then 0 else 1 end`] : []), ...byUrgency)
    .limit(limit);
});

/** A person's answer to an agent's question or decision, as the asking agent collects it. */
export interface CollectedAnswer {
  taskId: string;
  taskTitle: string;
  requestId: string;
  kind: InputAnswer["kind"];
  question: string;
  outcome: InputAnswer["outcome"];
  /** Empty when the person said they answered elsewhere (in your conversation, say). */
  answer: string;
  /** The option the answer picks, if it picks exactly one. */
  chosenOption: string | null;
  /** Every option the answer picks: several on a request that takes several, else at most one. */
  chosenOptions: string[];
  answeredByName: string | null;
  answeredAt: string;
}

const uncollectedBy = (agentId: string) => sql`${tasks.inputAnswers} @> ${JSON.stringify([{ agentId, collected: false }])}::jsonb`;

/**
 * Answers people gave to the acting agent's questions since it last collected, oldest first. Each
 * is marked collected, so it is delivered exactly once, whichever of the agent's sessions asks.
 */
export const collectAnswers = service(CollectAnswersInput, async (ctx, { taskIds }): Promise<CollectedAnswer[]> => {
  assertCan(ctx, "task:write");
  const me = agentOnly(ctx, "Only agents collect answers. People see them on the Decisions page.");

  return inTransaction(ctx, async (tx) => {
    const rows = await tx.db
      .select(taskColumns)
      .from(tasks)
      .where(and(inTenant(tx, tasks), uncollectedBy(me), taskIds?.length ? inArray(tasks.id, taskIds) : undefined))
      .for("update");

    const collected: CollectedAnswer[] = [];
    for (const row of rows) {
      const inputAnswers = row.inputAnswers.map((entry) => {
        if (entry.agentId !== me || entry.collected) return entry;
        collected.push({
          taskId: row.id,
          taskTitle: row.title,
          requestId: entry.id,
          kind: entry.kind,
          question: entry.question,
          outcome: entry.outcome,
          answer: entry.answer,
          chosenOption: entry.choices ? (entry.choices.length === 1 ? entry.choices[0]! : null) : entry.answer ? chosenOption(entry, entry.answer) : null,
          chosenOptions: chosenOptions(entry),
          answeredByName: entry.answeredByName,
          answeredAt: entry.closedAt,
        });
        return { ...entry, collected: true };
      });
      await tx.db.update(tasks).set({ inputAnswers }).where(tenantRow(tx, tasks, row.id));
    }
    return collected.sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  });
});

/** How often a waiting agent checks for answers. */
export const ANSWER_POLL_MS = 1500;

export interface WaitResult {
  answers: CollectedAnswer[];
  timedOut: boolean;
  /** Questions of yours still open, on these tasks if you named them. */
  stillOpen: number;
}

/**
 * Blocks until a person answers one of the acting agent's questions (on `taskIds`, if given), then
 * collects and returns the answers. Polls the database, so an answer given on any instance of the
 * web app wakes it. Returns `timedOut` with nothing collected when the wait runs out.
 */
export const waitForAnswers = service(WaitForAnswersInput, async (ctx, { taskIds, timeoutSeconds }): Promise<WaitResult> => {
  const me = agentOnly(ctx, "Only agents wait for answers.");
  const deadline = Date.now() + timeoutSeconds * 1000;
  const stillOpen = async () => {
    const [row] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          inTenant(ctx, tasks),
          isAwaitingInput,
          sql`${tasks.inputRequest}->>'agentId' = ${me}`,
          taskIds?.length ? inArray(tasks.id, taskIds) : undefined,
        ),
      );
    return row?.n ?? 0;
  };

  for (;;) {
    const answers = await collectAnswers(ctx, { taskIds });
    if (answers.length) return { answers, timedOut: false, stillOpen: await stillOpen() };
    const left = deadline - Date.now();
    if (left <= 0) return { answers: [], timedOut: true, stillOpen: await stillOpen() };
    await new Promise((resolve) => setTimeout(resolve, Math.min(ANSWER_POLL_MS, left)));
  }
});

/** A closed question or decision, with the task it was asked on. */
export interface DecisionRecord {
  task: Pick<TaskView, "id" | "title" | "status" | "goalId" | "goalTitle" | "agentSessions">;
  request: InputAnswer;
}

export interface Decisions {
  /** Waiting on a person, longest waiting first. */
  open: TaskView[];
  /** Answered or closed, newest first. */
  closed: DecisionRecord[];
}

/** Everything agents asked people to decide or answer: what still waits, and what was settled. */
export const listDecisions = service(DecisionsInput, async (ctx, { limit }): Promise<Decisions> => {
  assertCan(ctx, "workspace:read");
  const [open, withHistory] = await Promise.all([
    selectTaskViews(ctx, isAwaitingInput).orderBy(sql`${tasks.inputRequest}->>'askedAt'`),
    selectTaskViews(ctx, sql`jsonb_array_length(${tasks.inputAnswers}) > 0`),
  ]);
  const closedRecords = withHistory
    .flatMap(({ id, title, status, goalId, goalTitle, agentSessions, inputAnswers }) =>
      inputAnswers.map((request) => ({ task: { id, title, status, goalId, goalTitle, agentSessions }, request })),
    )
    .sort((a, b) => b.request.closedAt.localeCompare(a.request.closedAt))
    .slice(0, limit);
  return { open, closed: closedRecords };
});

export interface TaskDetail {
  task: TaskView;
  /** The task it is a step of, if any. */
  parent: Pick<Task, "id" | "title" | "status"> | null;
  subtasks: TaskView[];
  activity: Activity[];
}

/** One task with everything on it: links, sessions, open and answered questions, subtasks, history. */
export const getTask = service(TaskRefInput, async (ctx, { taskId }): Promise<TaskDetail> => {
  assertCan(ctx, "workspace:read");
  const [task] = await selectTaskViews(ctx, eq(tasks.id, taskId));
  if (!task) throw notFound("task", taskId);
  const [parent, subtasks, activity] = await Promise.all([
    task.parentTaskId ? findTask(ctx, task.parentTaskId).then(({ id, title, status }) => ({ id, title, status })) : null,
    selectTaskViews(ctx, eq(tasks.parentTaskId, task.id)).orderBy(asc(tasks.createdAt)),
    taskActivity(ctx, task.id),
  ]);
  return { task, parent, subtasks, activity };
});
