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
import { agents, goals, tasks, type TaskRow } from "../db/schema";
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
  LinkSessionInput,
  ListTasksInput,
  NextActionsInput,
  SessionInput,
  TaskDraft,
  TaskRefInput,
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

export const isOpenTask = inArray(tasks.status, [...OPEN_TASK_STATUSES]);
export const isOverdue = and(isOpenTask, sql`${tasks.dueDate} < current_date`)!;
export const isDueWithinWeek = and(
  isOpenTask,
  sql`${tasks.dueDate} between current_date and current_date + 7`,
)!;
export const isAwaitingInput = and(isOpenTask, isNotNull(tasks.inputRequest))!;

const parentTask = alias(tasks, "parent_task");

const subtaskTally = (filter: SQL) =>
  sql<number>`(select count(*)::int from tasks as sub where sub.tenant_id = ${tasks.tenantId} and sub.parent_task_id = ${tasks.id} and ${filter})`;

/** Selects tenant tasks as `TaskView`s; callers add filters, ordering, and limits. */
export function selectTaskViews(ctx: Ctx, where?: SQL) {
  return ctx.db
    .select({
      ...taskColumns,
      goalTitle: goals.title,
      claimedByName: agents.name,
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
    // A claim only means "an agent is working on it right now"; its open question goes with it.
    if (statusChange !== "in_progress") Object.assign(patch, { claimedByAgentId: null, claimedAt: null, ...closeOpenRequest() });
  }

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
  const me = agentOnly(ctx, "Only agents claim tasks. Humans can move a task to In progress instead.");
  const linked = session && sessionOf(ctx, session);

  return inTransaction(ctx, async (tx) => {
    // One conditional UPDATE: concurrent claims cannot both succeed.
    const [claimed] = await tx.db
      .update(tasks)
      // A task already in one of the workspace's in-progress stages ("Review") stays in it.
      .set({ claimedByAgentId: me, claimedAt: new Date(), status: "in_progress", stage: sql`case when ${tasks.status} = 'in_progress' then ${tasks.stage} else null end` })
      .where(
        and(
          inTenant(tx, tasks),
          eq(tasks.id, taskId),
          isOpenTask,
          or(isNull(tasks.claimedByAgentId), eq(tasks.claimedByAgentId, me)),
        ),
      )
      .returning(taskColumns);

    if (!claimed) {
      const current = await findTask(tx, taskId);
      if (!isOpenTaskStatus(current.status)) {
        throw conflict(`"${current.title}" is already ${TASK_STATUS_META[current.status].label.toLowerCase()}.`);
      }
      await assertNotClaimedByOther(tx, current);
      throw conflict(`Could not claim "${current.title}".`);
    }

    // The claim's UPDATE holds the row, so the sessions read back are current.
    const [task] = linked
      ? await tx.db
          .update(tasks)
          .set({ agentSessions: withSession(claimed.agentSessions, linked) })
          .where(tenantRow(tx, tasks, taskId))
          .returning(taskColumns)
      : [claimed];

    await recordEvent(tx, {
      action: "task.claimed",
      entityType: "task",
      entityId: taskId,
      summary: `claimed "${claimed.title}"`,
      data: { goalId: claimed.goalId, ...(linked && { session: sessionData(linked) }) },
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
      .set({ agentSessions: withSession(current.agentSessions, next) })
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

    const inputRequest: InputRequest = {
      id: newId("q"),
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
      .set({ inputRequest, inputAnswers, ...(next && { agentSessions: withSession(current.agentSessions, next) }) })
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
        ...closeOpenRequest(),
        status: current.status === "in_progress" ? "todo" : current.status,
        stage: current.status === "in_progress" ? null : current.stage,
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
      .set({ status: "done", stage: null, completedAt: new Date(), claimedByAgentId: null, claimedAt: null, ...closeOpenRequest(), description })
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
      input.parentTaskId ? eq(tasks.parentTaskId, input.parentTaskId) : undefined,
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
      // Agents should not be steered toward work another agent holds, or work waiting on a person.
      me ? and(or(isNull(tasks.claimedByAgentId), eq(tasks.claimedByAgentId, me)), isNull(tasks.inputRequest)) : undefined,
    ),
  )
    .orderBy(...byUrgency)
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
