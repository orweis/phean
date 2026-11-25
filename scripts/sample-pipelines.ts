/**
 * A demo pipeline for the sample workspace, so the Pipelines tab, a pipeline's map, runs grid and
 * insights, and a run page have something to show: a weekly partner newsletter that an agent drafts,
 * the owner reviews and another agent sends. Its runs are driven through the real services (so every
 * stop, task and event is what the engine makes), then backdated over the last three weeks with
 * believable stop times. Every run has finished but the last, whose draft was handed to its agent
 * 90 minutes ago and never picked up (stuck, resent five times), so the stuck filter and Resend have
 * something to show. Every run's tasks are archived, so the board, the overview and Decisions read
 * as before. Runs only on a workspace with no pipelines.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "../src/server/db/client";
import { agents, events, pipelineRuns, pipelineRunStops, pipelines, tasks } from "../src/server/db/schema";
import type { Ctx, Tenant } from "../src/server/domain/context";
import { definePipeline, getRun, startRun, type RunView } from "../src/server/domain/pipelines";
import { answerInput, claimTask, completeTask, updateTask } from "../src/server/domain/tasks";

const HOUR = 3600_000;
const MINUTE = 60_000;

/** Each run: days ago, how the review went, and minutes for draft, review and send. */
const RUNS: { daysAgo: number; review: "Approve" | "Needs changes"; draft: number; wait: number; send: number; draftFails?: boolean }[] = [
  { daysAgo: 20, review: "Approve", draft: 55, wait: 190, send: 9 },
  { daysAgo: 17, review: "Approve", draft: 42, wait: 75, send: 12 },
  { daysAgo: 14, review: "Needs changes", draft: 80, wait: 620, send: 0 },
  { daysAgo: 12, review: "Approve", draft: 38, wait: 140, send: 8, draftFails: true },
  { daysAgo: 9, review: "Approve", draft: 61, wait: 1260, send: 15 },
  { daysAgo: 6, review: "Approve", draft: 47, wait: 95, send: 10 },
  { daysAgo: 3, review: "Approve", draft: 52, wait: 230, send: 11 },
  { daysAgo: 1, review: "Approve", draft: 44, wait: 310, send: 9 },
];

const agentCtx = async (db: Db, tenant: Tenant, name: string): Promise<Ctx> => {
  const [agent] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.tenantId, tenant.id), eq(agents.name, name)));
  if (!agent) throw new Error(`The sample workspace has no agent named ${name}`);
  return { db, tenant, actor: { type: "agent", id: agent.id, name, role: "agent_write" } };
};

const stopTask = (view: RunView, stopId: string) => view.stops.find((stop) => stop.stopId === stopId)?.task?.id;

export async function seedSamplePipelines(db: Db, owner: Ctx): Promise<number> {
  const existing = await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.tenantId, owner.tenant.id)).limit(1);
  if (existing.length) return 0;
  const sweeper = await agentCtx(db, owner.tenant, "Inbox sweeper");
  const planner = await agentCtx(db, owner.tenant, "Calendar planner");

  const { pipeline } = await definePipeline(owner, {
    name: "Weekly partner newsletter",
    kind: "regular",
    description: "Every Monday: what partners need to know this week, drafted by an agent, approved by a person, then sent.",
    definition: {
      inputs: [],
      stops: [
        {
          id: "draft",
          name: "Draft the newsletter",
          kind: "agent",
          agent: "Inbox sweeper",
          instructions: "Draft this week's partner newsletter (run {{run.number}}) from the partner channel and the portal changelog.",
          outputs: ["a draft document"],
          timeLimitMinutes: 240,
          onFailure: { action: "retry", times: 1 },
          then: { next: "review" },
        },
        {
          id: "review",
          name: "Review",
          kind: "person",
          person: owner.actor.id,
          instructions: "Send this week's partner newsletter as drafted?",
          timeLimitMinutes: 60 * 24,
          onTimeout: "Needs changes",
          then: { choice: [{ label: "Approve", to: "send" }, { label: "Needs changes", end: "held" }] },
        },
        { id: "send", name: "Send to partners", kind: "agent", agent: "Calendar planner", instructions: "Send the approved newsletter: {{stops.draft.result}}", then: { end: "sent" } },
      ],
      ends: [
        { id: "sent", name: "Sent" },
        { id: "held", name: "Held for changes" },
      ],
    },
    triggers: { schedule: { cron: "0 9 * * 1", timeZone: "Europe/Berlin" } },
  });

  const now = Date.now();
  for (const plan of RUNS) {
    let view = await startRun(owner, { pipelineId: pipeline.id });
    const draft = stopTask(view, "draft")!;
    if (plan.draftFails) {
      // The first attempt is dropped; the stop's rule retries it once.
      await claimTask(sweeper, { taskId: draft });
      await updateTask(sweeper, { taskId: draft, status: "dropped" });
      view = await startRunView(owner, view.run.id);
    }
    const draftTask = stopTask(view, "draft")!;
    await claimTask(sweeper, { taskId: draftTask });
    await completeTask(sweeper, { taskId: draftTask, note: "Drafted: three partner wins, the new payout schedule, and the API changelog." });
    view = await startRunView(owner, view.run.id);
    await answerInput(owner, { taskId: stopTask(view, "review")!, answer: plan.review });
    view = await startRunView(owner, view.run.id);
    if (plan.review === "Approve") {
      const send = stopTask(view, "send")!;
      await claimTask(planner, { taskId: send });
      await completeTask(planner, { taskId: send, note: "Sent to 214 partners." });
    }
    await backdate(db, owner.tenant, view.run.id, now - plan.daysAgo * 24 * HOUR, plan);
  }
  await seedStuckRun(db, owner, pipeline.id, now);
  return RUNS.length + 1;
}

/** A run whose draft the sweeper never picked up: handed off 90 minutes ago, resent at 3, 6, 12, 24 and 48 minutes. */
async function seedStuckRun(db: Db, owner: Ctx, pipelineId: string, now: number) {
  const view = await startRun(owner, { pipelineId, name: "Holiday payout schedule" });
  const draft = stopTask(view, "draft")!;
  const shift = sql`interval '90 minutes'`;
  const handedOffAt = new Date(now - 90 * MINUTE);
  await db
    .update(pipelineRunStops)
    .set({ startedAt: sql`${pipelineRunStops.startedAt} - ${shift}`, dueAt: sql`${pipelineRunStops.dueAt} - ${shift}`, handedOffAt: sql`${pipelineRunStops.handedOffAt} - ${shift}`, handoffResends: 5 })
    .where(eq(pipelineRunStops.runId, view.run.id));
  await db
    .update(pipelineRunStops)
    .set({ handoffRetryAt: sql`${pipelineRunStops.handedOffAt} + interval '96 minutes'` })
    .where(eq(pipelineRunStops.runId, view.run.id));
  await db.update(pipelineRuns).set({ startedAt: handedOffAt, createdAt: handedOffAt }).where(eq(pipelineRuns.id, view.run.id));
  await db
    .update(tasks)
    .set({ delegatedAt: sql`${tasks.delegatedAt} - ${shift}`, createdAt: sql`${tasks.createdAt} - ${shift}`, archivedAt: new Date(now) })
    .where(and(eq(tasks.tenantId, owner.tenant.id), inArray(tasks.id, [draft, view.run.taskId!])));
}

const startRunView = (ctx: Ctx, runId: string): Promise<RunView> => getRun(ctx, { runId });

/** Moves a run, its stops, its tasks and their events to `start`, with the plan's stop times; finished runs' tasks are archived. */
async function backdate(db: Db, tenant: Tenant, runId: string, start: number, plan: (typeof RUNS)[number], finished = true) {
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
  const rows = await db.select().from(pipelineRunStops).where(eq(pipelineRunStops.runId, runId));
  const shift = start - run!.startedAt.getTime();
  const draftEnd = start + plan.draft * MINUTE;
  const reviewEnd = draftEnd + plan.wait * MINUTE;
  const sendEnd = reviewEnd + plan.send * MINUTE;
  const times: Record<string, [number, number | null]> = {
    draft: [start, draftEnd],
    review: [draftEnd, finished ? reviewEnd : null],
    send: [reviewEnd, plan.send ? sendEnd : reviewEnd],
  };
  for (const row of rows) {
    const [from, to] = times[row.stopId]!;
    const failedAttempt = row.supersededAt !== null || (row.stopId === "draft" && row.state === "failed");
    await db
      .update(pipelineRunStops)
      .set({
        startedAt: new Date(failedAttempt ? from - 30 * MINUTE : from),
        endedAt: row.endedAt ? new Date(failedAttempt ? from : (to ?? from)) : null,
        dueAt: row.dueAt ? new Date(row.dueAt.getTime() + shift) : null,
        remindAt: row.remindAt ? new Date(row.remindAt.getTime() + shift) : null,
      })
      .where(eq(pipelineRunStops.id, row.id));
  }
  const end = finished ? (plan.review === "Approve" ? sendEnd : reviewEnd) : null;
  await db
    .update(pipelineRuns)
    .set({ startedAt: new Date(start), endedAt: end ? new Date(end) : null, createdAt: new Date(start) })
    .where(eq(pipelineRuns.id, runId));
  const taskIds = [run!.taskId!, ...rows.flatMap((row) => (row.taskId ? [row.taskId] : []))];
  const taskRows = await db.select({ id: tasks.id, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt, completedAt: tasks.completedAt }).from(tasks).where(inArray(tasks.id, taskIds));
  for (const task of taskRows) {
    await db
      .update(tasks)
      .set({
        createdAt: new Date(task.createdAt.getTime() + shift),
        updatedAt: new Date(task.updatedAt.getTime() + shift),
        completedAt: task.completedAt ? new Date(task.completedAt.getTime() + shift) : null,
        ...(finished && { archivedAt: new Date((end ?? start) + MINUTE) }),
      })
      .where(and(eq(tasks.tenantId, tenant.id), eq(tasks.id, task.id)));
  }
  const logged = await db.select({ id: events.id, createdAt: events.createdAt }).from(events).where(and(eq(events.tenantId, tenant.id), inArray(events.entityId, [...taskIds, runId])));
  for (const event of logged) await db.update(events).set({ createdAt: new Date(event.createdAt.getTime() + shift) }).where(eq(events.id, event.id));
}
