import { and, eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { events, pipelineRunStops, pipelineTriggers, tasks, webhookDeliveries, webhooks } from "@/server/db/schema";
import { agentContext, authenticateAgentToken, createAgent, createSubagent, revokeAgent } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";
import { listActivity } from "@/server/domain/events";
import { fireSchedule, sweepDeadlines, sweepHandoffRetries, systemContext } from "@/server/domain/pipeline-engine";
import {
  approvePipelineVersion,
  cancelRun,
  definePipeline,
  describePipelineRequests,
  getPipeline,
  getPipelineVersion,
  getRun,
  getRunActivity,
  listPipelineBoard,
  pipelineHistory,
  taskLine,
  listRuns,
  listStuckStops,
  pausePipeline,
  rejectPipelineVersion,
  rerunFrom,
  resendHandoff,
  startRun,
  updatePipeline,
  updateRun,
  type RunView,
} from "@/server/domain/pipelines";
import { answerInput, captureTasks, claimTask, completeTask, getTask, handOffTask, listTasks, releaseTask, updateTask } from "@/server/domain/tasks";
import { handlePipelineTrigger, PIPELINE_TRIGGER_LIMIT } from "@/server/pipelines/trigger";
import { registerWebhook } from "@/server/domain/webhooks";

import { addMember, asUser, createTestDb, seedUser, seedWorkspace, type TestDb, type TestUser, type Workspace } from "./support/db";

let testDb: TestDb;
let ws: Workspace;
let human: Ctx;
let scout: Ctx;
let closer: Ctx;
let lee: TestUser;
let leeCtx: Ctx;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  ws = await seedWorkspace(testDb.db);
  ({ human } = ws);
  scout = ws.scout.ctx;
  closer = ws.closer.ctx;
  lee = await seedUser(testDb.db, "Lee");
  await addMember(testDb.db, ws.tenant, lee, "member");
  leeCtx = asUser(testDb.db, ws.tenant, lee, "member");
});

type StopDraft = Record<string, unknown> & { id: string; then: Record<string, unknown> };
const agentStop = (id: string, agent: string, then: Record<string, unknown>, extra: Record<string, unknown> = {}): StopDraft => ({ id, name: id, kind: "agent", agent, then, ...extra });
const ends = (...ids: string[]) => ids.map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) }));

interface DefineOptions {
  ends?: string[];
  inputs?: { name: string; required?: boolean }[];
  triggers?: Record<string, unknown>;
}

function define(ctx: Ctx, stops: StopDraft[], { ends: endIds = ["done"], inputs = [], triggers }: DefineOptions = {}) {
  return definePipeline(ctx, { name: "Newsletter", definition: { stops, ends: ends(...endIds), inputs } as never, ...(triggers && { triggers: triggers as never }) });
}

const stopIn = (view: RunView, id: string) => view.stops.find((stop) => stop.stopId === id)!;
const run = (runId: string) => getRun(human, { runId });
/** The task of a stop, once the run has reached it. */
const taskOf = async (runId: string, stopId: string) => stopIn(await run(runId), stopId).task!.id;

describe("a linear pipeline", () => {
  it("hands each stop off by name, passes results on, and ends at its end with the run's task done", async () => {
    const { pipeline } = await define(human, [
      agentStop("research", "Scout", { next: "draft" }, { instructions: "Research {{input.topic}}." }),
      agentStop("draft", "Closer", { end: "sent" }, { instructions: "Draft it from: {{stops.research.result}}" }),
    ], { ends: ["sent"], inputs: [{ name: "topic", required: true }] });
    await expect(startRun(human, { pipelineId: pipeline.id })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining('"topic"') });
    await expect(startRun(human, { pipelineId: pipeline.id, inputs: { topic: "AI", tone: "dry" } })).rejects.toMatchObject({ message: expect.stringContaining('no input named "tone"') });

    const started = await startRun(human, { pipelineId: pipeline.id, inputs: { topic: "AI agents" } });
    expect(started).toMatchObject({ headline: "At research", run: { number: 1, status: "running", trigger: "manual", triggeredByName: "Dana" } });
    expect(stopIn(started, "draft").state).toBe("upcoming");
    const research = stopIn(started, "research").task!.id;

    // Scout hears it as any handoff: handed to it by name, from the pipeline, with the rendered note.
    const handed = await listTasks(scout, { claimed: "handed_to_me" });
    expect(handed.map((task) => task.id)).toEqual([research]);
    expect(handed[0]).toMatchObject({ delegation: "handing_off", delegationNote: expect.stringContaining("Research AI agents."), parentTaskId: started.run.taskId, handedOffBy: { kind: "agent", name: "Pipelines" } });

    await claimTask(scout, { taskId: research });
    await completeTask(scout, { taskId: research, note: "Three trends: tools, memory, evals." });
    const second = await run(started.run.id);
    expect(stopIn(second, "research")).toMatchObject({ state: "done", result: { outcome: "completed", note: "Three trends: tools, memory, evals.", by: "Scout" } });
    const draft = (await getTask(closer, { taskId: stopIn(second, "draft").task!.id })).task;
    expect(draft.delegationNote).toContain("Draft it from: Three trends: tools, memory, evals.");
    expect(draft.description).toContain('From "research" (Scout): Three trends');

    await completeTask(closer, { taskId: draft.id, note: "Sent to 1,200 readers." });
    const ended = await run(started.run.id);
    expect(ended).toMatchObject({ headline: "Ended: Sent", run: { status: "done", endId: "sent", endName: "Sent", task: { status: "done" } } });

    // Every step is in the activity log, so webhooks and the timeline hear it.
    const actions = (await listActivity(human, { limit: 100 })).map((event) => event.action);
    expect(actions).toEqual(expect.arrayContaining(["pipeline.defined", "pipeline.run_started", "pipeline.stop_reached", "pipeline.stop_completed", "pipeline.run_ended"]));
  });

  it("finishes a stop handed back to the pipeline, with the hand-back note as its result", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { next: "two" }), agentStop("two", "Closer", { end: "done" })]);
    const started = await startRun(scout, { pipelineId: pipeline.id });
    expect(started.run).toMatchObject({ trigger: "agent", triggeredByName: "Scout" });
    const one = stopIn(started, "one").task!.id;
    await claimTask(scout, { taskId: one });
    await handOffTask(scout, { taskId: one, handBack: true, note: "Found it: the March report." });
    const view = await run(started.run.id);
    expect(stopIn(view, "one")).toMatchObject({ state: "done", result: { outcome: "handed_back", note: "Found it: the March report." }, task: { status: "done" } });
    expect(stopIn(view, "two").state).toBe("active");
  });

  it("refuses agents and people the workspace does not have, before anything is saved", async () => {
    await expect(define(human, [agentStop("one", "Nobody", { end: "done" })])).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining('no connected agent is named or has the id "Nobody"') });
    await expect(define(human, [{ id: "ok", name: "OK", kind: "person", person: "stranger@example.com", then: { end: "done" } }])).rejects.toMatchObject({ message: expect.stringContaining("not a member") });
  });
});

describe("branches", () => {
  it("forks, and a join waits for all of its branches", async () => {
    const { pipeline } = await define(human, [
      agentStop("start", "Scout", { fork: ["legal", "brand"] }),
      agentStop("legal", "Scout", { next: "publish" }),
      agentStop("brand", "Closer", { next: "publish" }),
      agentStop("publish", "Closer", { end: "done" }),
    ]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await completeTask(scout, { taskId: stopIn(started, "start").task!.id, note: "Go" });
    let view = await run(started.run.id);
    expect(["legal", "brand"].map((id) => stopIn(view, id).state)).toEqual(["active", "active"]);
    await completeTask(scout, { taskId: stopIn(view, "legal").task!.id, note: "Cleared" });
    expect(stopIn(await run(started.run.id), "publish").state).toBe("upcoming");
    await completeTask(closer, { taskId: stopIn(view, "brand").task!.id, note: "On brand" });
    view = await run(started.run.id);
    expect(stopIn(view, "publish").state).toBe("active");
  });

  it("goes on with the first branch at a first join, and cancels the other", async () => {
    const { pipeline } = await define(human, [
      agentStop("start", "Scout", { fork: ["fast", "slow"] }),
      agentStop("fast", "Scout", { next: "use" }),
      agentStop("slow", "Closer", { next: "use" }),
      agentStop("use", "Scout", { end: "done" }, { join: "first" }),
    ]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await completeTask(scout, { taskId: stopIn(started, "start").task!.id });
    const view = await run(started.run.id);
    await completeTask(scout, { taskId: stopIn(view, "fast").task!.id, note: "Quote: $40" });
    const after = await run(started.run.id);
    expect(stopIn(after, "use").state).toBe("active");
    expect(stopIn(after, "slow")).toMatchObject({ state: "cancelled", task: { status: "dropped" } });
    // The losing branch's task is gone from the agent's queue.
    expect((await listTasks(closer, { claimed: "handed_to_me" })).map((task) => task.id)).not.toContain(stopIn(after, "slow").task!.id);
  });

  it("chooses a branch by the result's first words, and skips the others", async () => {
    const { pipeline } = await define(
      human,
      [
        agentStop("review", "Scout", { choice: [{ label: "approved", to: "send" }, { label: "needs changes", to: "fix" }] }),
        agentStop("fix", "Closer", { end: "dropped" }),
        agentStop("send", "Closer", { end: "sent" }),
      ],
      { ends: ["sent", "dropped"] },
    );
    const started = await startRun(human, { pipelineId: pipeline.id });
    const review = (await getTask(scout, { taskId: stopIn(started, "review").task!.id })).task;
    expect(review.delegationNote).toContain('Start your note with one of "approved", "needs changes"');
    await completeTask(scout, { taskId: review.id, note: "Approved: the numbers check out." });
    const view = await run(started.run.id);
    expect(stopIn(view, "review").branch).toBe("approved");
    expect(stopIn(view, "send").state).toBe("active");
    expect(stopIn(view, "fix").state).toBe("skipped");
    await completeTask(closer, { taskId: stopIn(view, "send").task!.id });
    expect((await run(started.run.id)).run).toMatchObject({ status: "done", endId: "sent" });
  });

  it("fails a stop whose result names no branch, and retries it with the labels when its rule says so", async () => {
    const { pipeline } = await define(human, [
      agentStop("review", "Scout", { choice: [{ label: "yes", end: "done" }, { label: "no", end: "done" }] }, { onFailure: { action: "retry", times: 1 } }),
    ]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await completeTask(scout, { taskId: stopIn(started, "review").task!.id, note: "Looks fine to me" });
    const view = await run(started.run.id);
    expect(stopIn(view, "review")).toMatchObject({ state: "active", attempt: 2, reason: expect.stringContaining("named none of the branches") });
    const retry = (await getTask(scout, { taskId: stopIn(view, "review").task!.id })).task;
    expect(retry.title).toBe("review (attempt 2)");
    expect(retry.delegationNote).toContain("Attempt 2 of 2");
  });
});

describe("person stops", () => {
  const reviewStop = (extra: Record<string, unknown> = {}): StopDraft => ({
    id: "review",
    name: "Review the draft",
    kind: "person",
    person: human.actor.id,
    instructions: "Approve the newsletter for sending?",
    then: { choice: [{ label: "Approve", to: "send" }, { label: "Needs changes", end: "held" }] },
    ...extra,
  });

  async function personPipeline(extra: Record<string, unknown> = {}) {
    const { pipeline } = await define(human, [reviewStop(extra), agentStop("send", "Closer", { end: "sent" })], { ends: ["sent", "held"] });
    return pipeline;
  }

  it("asks the person for a decision, as the pipeline, and their answer picks the branch", async () => {
    const pipeline = await personPipeline();
    const started = await startRun(scout, { pipelineId: pipeline.id });
    expect(started.headline).toBe("Waiting on Dana at Review the draft");
    expect(started.run.status).toBe("waiting");
    const task = (await getTask(human, { taskId: stopIn(started, "review").task!.id })).task;
    expect(task.inputRequest).toMatchObject({
      kind: "decision",
      question: "Approve the newsletter for sending?",
      options: ["Approve", "Needs changes"],
      agentName: "Newsletter",
      pipeline: { pipelineId: pipeline.id, pipelineName: "Newsletter", runId: started.run.id, runNumber: 1, stopId: "review", stopName: "Review the draft" },
    });
    expect(task).toMatchObject({ delegation: "handing_off", delegateToUserId: human.actor.id });

    // Only Dana decides here.
    await expect(answerInput(leeCtx, { taskId: task.id, answer: "Approve" })).rejects.toMatchObject({ code: "forbidden", message: 'Only Dana decides at "Review the draft".' });
    await answerInput(human, { taskId: task.id, answer: "Approve" });
    const view = await run(started.run.id);
    expect(stopIn(view, "review")).toMatchObject({ state: "done", branch: "Approve", result: { outcome: "answered", answer: "Approve", by: "Dana" }, task: { status: "done" } });
    expect(stopIn(view, "send").state).toBe("active");
    // The answer was the run's to act on: it is collected, so nobody else collects it and it cannot be taken back.
    expect((await getTask(human, { taskId: task.id })).task.inputAnswers[0]).toMatchObject({ outcome: "answered", collected: true });
  });

  it("asks again when an answer picks no branch", async () => {
    const pipeline = await personPipeline();
    const started = await startRun(human, { pipelineId: pipeline.id });
    const taskId = stopIn(started, "review").task!.id;
    await answerInput(human, { taskId, answer: "Maybe next week" });
    const task = (await getTask(human, { taskId })).task;
    expect(task.inputRequest).toMatchObject({ context: expect.stringContaining("picks no branch of the run"), pipeline: { stopId: "review" } });
    expect(stopIn(await run(started.run.id), "review").state).toBe("waiting");
  });

  it("informs a person at an advisory stop without holding the run", async () => {
    const { pipeline } = await define(human, [
      { id: "fyi", name: "Tell Dana", kind: "person", person: human.actor.id, blocking: false, instructions: "FYI: the newsletter goes out today.", then: { next: "send" } },
      agentStop("send", "Closer", { end: "done" }),
    ]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    expect(stopIn(started, "fyi")).toMatchObject({ state: "done", result: { outcome: "informed" } });
    expect(stopIn(started, "send").state).toBe("active");
    const fyi = (await getTask(human, { taskId: stopIn(started, "fyi").task!.id })).task;
    expect(fyi).toMatchObject({ status: "todo", inputRequest: null, delegateToUserId: human.actor.id, delegationNote: "FYI: the newsletter goes out today." });
  });

  it("reminds half way and takes the default at the time limit", async () => {
    const pipeline = await personPipeline({ timeLimitMinutes: 60, onTimeout: "Needs changes" });
    const started = await startRun(human, { pipelineId: pipeline.id });
    const taskId = stopIn(started, "review").task!.id;
    const asked = (await getTask(human, { taskId })).task.inputRequest!;
    const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);

    expect(await sweepDeadlines(human, { now: at(10) })).toEqual({ reminded: 0, timedOut: 0 });
    expect(await sweepDeadlines(human, { now: at(31) })).toEqual({ reminded: 1, timedOut: 0 });
    const reminded = (await getTask(human, { taskId })).task.inputRequest!;
    expect(reminded.id).not.toBe(asked.id);
    expect(reminded.context).toMatch(/^Reminder: the run waits on this decision/);
    expect(await sweepDeadlines(human, { now: at(32) })).toEqual({ reminded: 0, timedOut: 0 });

    expect(await sweepDeadlines(human, { now: at(61) })).toEqual({ reminded: 0, timedOut: 1 });
    const view = await run(started.run.id);
    expect(stopIn(view, "review")).toMatchObject({ state: "done", branch: "Needs changes", result: { outcome: "timed_out", answer: "Needs changes" } });
    expect(view.run).toMatchObject({ status: "done", endId: "held" });
  });

  it("needs several people to agree when the stop asks a role for more than one approval", async () => {
    const kim = await seedUser(testDb.db, "Kim");
    await addMember(testDb.db, ws.tenant, kim, "member");
    const { pipeline } = await define(human, [
      { id: "vote", name: "Vote", kind: "person", role: "member", approvals: 2, then: { choice: [{ label: "Ship", end: "shipped" }, { label: "Wait", end: "waited" }] } },
    ], { ends: ["shipped", "waited"] });
    const started = await startRun(human, { pipelineId: pipeline.id });
    const taskId = stopIn(started, "vote").task!.id;
    await answerInput(human, { taskId, answer: "Ship" });
    await answerInput(leeCtx, { taskId, answer: "Wait" });
    expect((await getTask(human, { taskId })).task.inputRequest?.context).toMatch(/2 people must agree. So far: "Ship": Dana; "Wait": Lee/);
    await answerInput(asUser(testDb.db, ws.tenant, kim, "member"), { taskId, answer: "Ship" });
    expect((await run(started.run.id)).run).toMatchObject({ status: "done", endId: "shipped" });
  });
});

describe("failure rules", () => {
  it("retries a dropped stop with the attempt count, then fails the run, never while a branch lives", async () => {
    const { pipeline } = await define(human, [agentStop("only", "Scout", { end: "done" }, { onFailure: { action: "retry", times: 1 } })]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await updateTask(scout, { taskId: stopIn(started, "only").task!.id, status: "dropped" });
    let view = await run(started.run.id);
    expect(stopIn(view, "only")).toMatchObject({ state: "active", attempt: 2 });
    await claimTask(scout, { taskId: stopIn(view, "only").task!.id });
    await releaseTask(scout, { taskId: stopIn(view, "only").task!.id, note: "Cannot reach the API" });
    view = await run(started.run.id);
    expect(stopIn(view, "only")).toMatchObject({ state: "failed", reason: expect.stringContaining("Cannot reach the API") });
    expect(view.run).toMatchObject({ status: "failed", task: { status: "todo" } });
  });

  it("keeps a run going on its other branch while one has failed", async () => {
    const { pipeline } = await define(human, [
      agentStop("start", "Scout", { fork: ["a", "b"] }),
      agentStop("a", "Scout", { end: "done" }),
      agentStop("b", "Closer", { end: "done" }),
    ]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await completeTask(scout, { taskId: stopIn(started, "start").task!.id });
    const view = await run(started.run.id);
    await updateTask(scout, { taskId: stopIn(view, "a").task!.id, status: "dropped" });
    expect((await run(started.run.id)).run.status).toBe("running");
    await completeTask(closer, { taskId: stopIn(view, "b").task!.id });
    expect((await run(started.run.id)).run.status).toBe("failed");
  });

  it("hands back to the stop before, with the reason, and comes back to it", async () => {
    const { pipeline } = await define(human, [agentStop("draft", "Scout", { next: "check" }), agentStop("check", "Closer", { end: "done" }, { onFailure: { action: "hand_back", times: 1 } })]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await completeTask(scout, { taskId: stopIn(started, "draft").task!.id, note: "v1" });
    let view = await run(started.run.id);
    await claimTask(closer, { taskId: stopIn(view, "check").task!.id });
    await releaseTask(closer, { taskId: stopIn(view, "check").task!.id, note: "The figures do not add up" });
    view = await run(started.run.id);
    expect(stopIn(view, "draft").state).toBe("active");
    expect(stopIn(view, "check").state).toBe("upcoming");
    expect(view.history.map((stop) => [stop.stopId, stop.state])).toEqual(expect.arrayContaining([["check", "failed"], ["draft", "done"]]));
    const again = (await getTask(scout, { taskId: stopIn(view, "draft").task!.id })).task;
    expect(again.delegationNote).toContain('Handed back from "check": Closer let it go: The figures do not add up');
    await completeTask(scout, { taskId: again.id, note: "v2" });
    expect(stopIn(await run(started.run.id), "check").state).toBe("active");
  });

  it("asks a person whether to retry, and retries on their word", async () => {
    const { pipeline } = await define(human, [agentStop("only", "Scout", { end: "done" }, { onFailure: { action: "ask" } })]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await updateTask(scout, { taskId: stopIn(started, "only").task!.id, status: "dropped" });
    let view = await run(started.run.id);
    expect(view).toMatchObject({ headline: "Waiting on Dana at only", run: { status: "waiting" } });
    const decide = (await getTask(human, { taskId: stopIn(view, "only").task!.id })).task;
    expect(decide.inputRequest).toMatchObject({ options: ["Retry", "Fail"], pipeline: { stopId: "only" } });
    await answerInput(human, { taskId: decide.id, answer: "Retry" });
    view = await run(started.run.id);
    expect(stopIn(view, "only")).toMatchObject({ state: "active", attempt: 2 });
  });

  it("fails a stop whose agent is gone, by its rule", async () => {
    const { pipeline } = await define(human, [agentStop("only", "Scout", { end: "done" })]);
    const { revokeAgent } = await import("@/server/domain/agents");
    await revokeAgent(human, { agentId: ws.scout.agentId });
    const started = await startRun(human, { pipelineId: pipeline.id });
    expect(stopIn(started, "only")).toMatchObject({ state: "failed", reason: expect.stringContaining("could not hand it over") });
    expect(started.run.status).toBe("failed");
  });
});

describe("cancelling and rerunning", () => {
  it("cancels a run: live stops cancelled, their tasks and the run's task dropped", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { end: "done" })]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    const view = await cancelRun(scout, { runId: started.run.id, reason: "Wrong topic" });
    expect(view).toMatchObject({ headline: "Cancelled", run: { status: "cancelled", summary: "Cancelled by Scout: Wrong topic", task: { status: "dropped" } } });
    expect(stopIn(view, "one")).toMatchObject({ state: "cancelled", task: { status: "dropped" } });
  });

  it("cancels the run when a person drops its task", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { end: "done" })]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await updateTask(human, { taskId: started.run.taskId!, status: "dropped" });
    expect((await run(started.run.id)).run.status).toBe("cancelled");
  });

  it("reruns from a stop: fresh subtasks for it and everything after, and an ended run runs again", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { next: "two" }), agentStop("two", "Closer", { end: "done" })]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await completeTask(scout, { taskId: stopIn(started, "one").task!.id, note: "first" });
    const firstTwo = await taskOf(started.run.id, "two");
    await completeTask(closer, { taskId: firstTwo });
    expect((await run(started.run.id)).run.status).toBe("done");

    const again = await rerunFrom(human, { runId: started.run.id, stopId: "one", note: "Use the newer data" });
    expect(again.run).toMatchObject({ status: "running", endId: null, task: { status: "in_progress" } });
    expect(stopIn(again, "one")).toMatchObject({ state: "active" });
    expect(stopIn(again, "two").state).toBe("upcoming");
    expect((await getTask(scout, { taskId: stopIn(again, "one").task!.id })).task.delegationNote).toContain("Rerun by Dana: Use the newer data");
    expect(again.history.map((stop) => stop.stopId).sort()).toEqual(["one", "two"]);
    await expect(rerunFrom(human, { runId: started.run.id, stopId: "two" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("runs on an existing task, but never on a subtask", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { end: "done" })]);
    const { created } = await captureTasks(human, { tasks: [{ title: "Launch" }] });
    const { created: subs } = await captureTasks(human, { tasks: [{ title: "Step", parentTaskId: created[0]!.id }] });
    await expect(startRun(human, { pipelineId: pipeline.id, taskId: subs[0]!.id })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("is a subtask") });
    const started = await startRun(human, { pipelineId: pipeline.id, taskId: created[0]!.id });
    expect(started.run.taskId).toBe(created[0]!.id);
    expect((await getTask(human, { taskId: created[0]!.id })).subtasks.map((task) => task.title)).toEqual(["Step", "one"]);
    await expect(startRun(human, { pipelineId: pipeline.id, taskId: created[0]!.id })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("ad hoc pipelines", () => {
  it("start at once and are archived when their trip ends", async () => {
    const { pipeline, run: first } = await definePipeline(scout, { name: "Split the report", kind: "adhoc", definition: { stops: [agentStop("one", "Closer", { end: "done" })], ends: ends("done") } as never });
    expect(first).toMatchObject({ number: 1, trigger: "agent" });
    await completeTask(closer, { taskId: await taskOf(first!.id, "one") });
    expect((await getPipeline(human, { pipelineId: pipeline.id })).pipeline.status).toBe("archived");
  });
});

describe("proposals", () => {
  const twoStops = { stops: [agentStop("one", "Scout", { next: "two" }), agentStop("two", "Closer", { end: "done" })], ends: ends("done") };

  it("turns an agent's change to a regular pipeline into a proposal a person approves", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { end: "done" })]);
    const proposed = await updatePipeline(scout, { pipelineId: pipeline.id, definition: twoStops as never, name: "Newsletter v2", reason: "Add a review by Closer" });
    expect(proposed.proposal).toMatchObject({ number: 2, proposalState: "proposed", baseVersion: 1, reason: "Add a review by Closer", createdByName: "Scout" });
    expect(proposed.pipeline).toMatchObject({ currentVersion: 1, name: "Newsletter" });
    await expect(updatePipeline(scout, { pipelineId: pipeline.id, triggers: { webhook: true } as never })).rejects.toMatchObject({ code: "forbidden" });

    // Agents never approve, and a member who does not own it cannot either.
    await expect(approvePipelineVersion(scout, { pipelineId: pipeline.id, version: 2 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(approvePipelineVersion(leeCtx, { pipelineId: pipeline.id, version: 2 })).rejects.toMatchObject({ code: "forbidden" });
    const approved = await approvePipelineVersion(human, { pipelineId: pipeline.id, version: 2 });
    expect(approved.pipeline).toMatchObject({ currentVersion: 2, name: "Newsletter v2" });
    expect(approved.proposal).toMatchObject({ proposalState: "approved", decidedByName: "Dana" });
    const started = await startRun(human, { pipelineId: pipeline.id });
    expect(started.run.version).toBe(2);
    expect(started.stops.map((stop) => stop.stopId)).toEqual(["one", "two"]);
  });

  it("refuses a stale proposal, and records a rejection with why", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { end: "done" })]);
    await updatePipeline(scout, { pipelineId: pipeline.id, definition: twoStops as never });
    await updatePipeline(human, { pipelineId: pipeline.id, description: "Weekly", definition: twoStops as never });
    await expect(approvePipelineVersion(human, { pipelineId: pipeline.id, version: 2 })).rejects.toMatchObject({ code: "conflict" });
    const rejected = await rejectPipelineVersion(human, { pipelineId: pipeline.id, version: 2, note: "Superseded" });
    expect(rejected).toMatchObject({ proposalState: "rejected", decisionNote: "Superseded" });
    const detail = await getPipeline(human, { pipelineId: pipeline.id });
    expect(detail.pipeline.currentVersion).toBe(3);
    expect(detail.proposals).toEqual([]);
    expect(detail.versions.map((version) => [version.number, version.proposalState])).toEqual([[3, null], [2, "rejected"], [1, null]]);
  });

  it("lets a member change only regular pipelines they own, and an ad hoc one anyone may", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { end: "done" })]);
    await expect(updatePipeline(leeCtx, { pipelineId: pipeline.id, description: "Mine now" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(pausePipeline(leeCtx, { pipelineId: pipeline.id })).rejects.toMatchObject({ code: "forbidden" });
    const { pipeline: own } = await define(leeCtx, [agentStop("one", "Scout", { end: "done" })]);
    expect((await updatePipeline(leeCtx, { pipelineId: own.id, description: "Weekly" })).pipeline.description).toBe("Weekly");
    await pausePipeline(human, { pipelineId: pipeline.id });
    await expect(startRun(human, { pipelineId: pipeline.id })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("paused") });
  });
});

describe("triggers", () => {
  it("starts one run per scheduled time, however often the sweep runs", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { end: "done" })], { triggers: { schedule: { cron: "15 * * * *", timeZone: "UTC" } } });
    const [trigger] = await testDb.db.select().from(pipelineTriggers).where(and(eq(pipelineTriggers.pipelineId, pipeline.id), eq(pipelineTriggers.kind, "schedule")));
    const next = new Date(trigger!.createdAt);
    next.setUTCHours(next.getUTCHours() + (next.getUTCMinutes() >= 15 ? 1 : 0), 15, 20, 0);
    const sys = systemContext(testDb.db, ws.tenant);
    expect(await fireSchedule(sys, trigger!.id, new Date(next.getTime() - 60_000))).toBe(false);
    expect(await fireSchedule(sys, trigger!.id, next)).toBe(true);
    expect(await fireSchedule(sys, trigger!.id, next)).toBe(false);
    expect(await fireSchedule(sys, trigger!.id, new Date(next.getTime() + 60_000))).toBe(false);
    const runs = await listRuns(human, { pipelineId: pipeline.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "schedule", triggeredByType: "system", scheduledFor: new Date(next.getTime() - 20_000) });
  });

  it("refuses a schedule for a pipeline that needs inputs", async () => {
    await expect(define(human, [agentStop("one", "Scout", { end: "done" })], { inputs: [{ name: "topic", required: true }], triggers: { schedule: { cron: "0 9 * * 1", timeZone: "UTC" } } })).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("A scheduled run starts with no inputs"),
    });
  });

  it("starts a run when a task is captured with its tag, with the task as input", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Closer", { end: "done" }, { instructions: "Follow up on {{input.task_title}}" })], {
      inputs: [{ name: "task_title" }],
      triggers: { events: [{ tag: "Lead" }] },
    });
    await captureTasks(scout, { tasks: [{ title: "Acme wants a demo", tags: ["lead"] }, { title: "Unrelated" }] });
    const runs = await listRuns(human, { pipelineId: pipeline.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "event", triggeredByName: "Scout", inputs: { task_title: "Acme wants a demo" } });
    const handed = await listTasks(closer, { claimed: "handed_to_me" });
    expect(handed[0]!.delegationNote).toContain("Follow up on Acme wants a demo");
  });

  it("starts a run from its webhook with the secret only, and limits callers", async () => {
    const { pipeline, webhookSecret, triggers } = await define(human, [agentStop("one", "Scout", { end: "done" })], {
      inputs: [{ name: "topic" }],
      triggers: { webhook: true },
    });
    expect(webhookSecret).toMatch(/^pht_/);
    expect(triggers.webhook).toEqual({ url: `/api/pipelines/${pipeline.id}/trigger` });
    const post = (secret: string | null, body: unknown, address = "203.0.113.7") =>
      handlePipelineTrigger(
        new Request(`http://phean.test/api/pipelines/${pipeline.id}/trigger`, {
          method: "POST",
          headers: { "x-forwarded-for": address, ...(secret && { authorization: `Bearer ${secret}` }) },
          body: JSON.stringify(body),
        }),
        { db: testDb.db, pipelineId: pipeline.id },
      );
    expect((await post(null, {})).status).toBe(401);
    expect((await post("pht_wrong", {})).status).toBe(401);
    expect((await post(webhookSecret!, { inputs: { tone: "dry" } })).status).toBe(400);
    const accepted = await post(webhookSecret!, { inputs: { topic: "Pricing" } });
    expect(accepted.status).toBe(202);
    const { runId } = (await accepted.json()) as { runId: string };
    expect((await run(runId)).run).toMatchObject({ trigger: "webhook", inputs: { topic: "Pricing" } });

    // Turning the webhook off makes its secret worthless.
    await updatePipeline(human, { pipelineId: pipeline.id, triggers: { webhook: false } as never });
    expect((await post(webhookSecret!, {}, "203.0.113.8")).status).toBe(401);

    const address = "198.51.100.9";
    for (let call = 0; call < PIPELINE_TRIGGER_LIMIT.max; call++) await post("pht_wrong", {}, address);
    expect((await post(webhookSecret!, {}, address)).status).toBe(429);
  });
});

describe("the app's reads", () => {
  const review = (): StopDraft => ({
    id: "review",
    name: "Review",
    kind: "person",
    person: human.actor.id,
    timeLimitMinutes: 120,
    onTimeout: "Drop",
    then: { choice: [{ label: "Approve", to: "send" }, { label: "Drop", end: "dropped" }] },
  });

  async function line() {
    const { pipeline } = await define(human, [agentStop("draft", "Scout", { next: "review" }), review(), agentStop("send", "Closer", { end: "sent" })], {
      ends: ["sent", "dropped"],
      triggers: { schedule: { cron: "0 9 * * 1", timeZone: "UTC" } },
    });
    return pipeline;
  }

  it("lists pipelines with their latest runs as a strip, their stops and their next scheduled run", async () => {
    const pipeline = await line();
    const first = await startRun(human, { pipelineId: pipeline.id });
    await cancelRun(human, { runId: first.run.id });
    await startRun(human, { pipelineId: pipeline.id });
    const [row] = await listPipelineBoard(human, {});
    expect(row).toMatchObject({ id: pipeline.id, runs: { total: 2, live: 1 }, line: [{ id: "draft", kind: "agent" }, { id: "review", kind: "person" }, { id: "send" }], inputs: [] });
    expect(row!.strip.map((run) => [run.number, run.status])).toEqual([
      [2, "running"],
      [1, "cancelled"],
    ]);
    expect(row!.nextRunAt?.getUTCDay()).toBe(1);
    await pausePipeline(human, { pipelineId: pipeline.id });
    expect((await listPipelineBoard(human, {}))[0]!.nextRunAt).toBeNull();
  });

  it("reads a pipeline's history with every stop row, a version's definition, and a run's activity", async () => {
    const pipeline = await line();
    const started = await startRun(human, { pipelineId: pipeline.id });
    const draft = stopIn(started, "draft").task!.id;
    await claimTask(scout, { taskId: draft });
    await completeTask(scout, { taskId: draft, note: "Drafted." });
    await rerunFrom(human, { runId: started.run.id, stopId: "draft" });
    const [history] = await pipelineHistory(human, { pipelineId: pipeline.id });
    expect(history).toMatchObject({ number: 1, status: "running", trigger: "manual" });
    expect(history!.stops.filter((row) => row.stopId === "draft").map((row) => [row.state, row.superseded])).toEqual([
      ["done", true],
      ["active", false],
    ]);
    expect(history!.stops.find((row) => row.stopId === "draft" && !row.superseded)?.taskStatus).toBe("todo");
    expect((await getPipelineVersion(human, { pipelineId: pipeline.id, version: 1 })).definition.stops).toHaveLength(3);
    await expect(getPipelineVersion(human, { pipelineId: pipeline.id, version: 9 })).rejects.toMatchObject({ code: "not_found" });
    const actions = (await getRunActivity(human, { runId: started.run.id })).map((event) => event.action);
    expect(actions).toEqual(expect.arrayContaining(["pipeline.run_started", "pipeline.stop_reached", "pipeline.run_rerun", "task.completed", "task.captured"]));
  });

  it("describes a pipeline decision: its place on the line, where each option leads, and its time limit", async () => {
    const pipeline = await line();
    const started = await startRun(human, { pipelineId: pipeline.id });
    const draft = stopIn(started, "draft").task!.id;
    await claimTask(scout, { taskId: draft });
    await completeTask(scout, { taskId: draft, note: "Drafted." });
    const described = await describePipelineRequests(human, { requests: [{ runId: started.run.id, stopId: "review" }, { runId: "r_missing", stopId: "review" }] });
    expect(Object.keys(described)).toEqual([`${started.run.id}:review`]);
    expect(described[`${started.run.id}:review`]).toMatchObject({
      pipelineName: "Newsletter",
      runNumber: 1,
      stopName: "Review",
      position: { index: 2, total: 3 },
      steps: [
        { option: "Approve", next: "send (Closer)" },
        { option: "Drop", next: "Ends: Dropped" },
      ],
      onTimeout: "Drop",
    });
    expect(described[`${started.run.id}:review`]!.dueAt).toBeInstanceOf(Date);
  });

  it("finds the line a task is on: the run it carries, or the stop it serves", async () => {
    const pipeline = await line();
    const started = await startRun(human, { pipelineId: pipeline.id });
    const draft = stopIn(started, "draft").task!.id;
    expect(await taskLine(human, { taskId: draft })).toMatchObject({
      role: "stop",
      pipeline: { id: pipeline.id, name: "Newsletter" },
      run: { number: 1, headline: "At draft" },
      stops: [
        { stopId: "draft", state: "handing_off", current: true, taskId: draft },
        { stopId: "review", state: "upcoming", current: false, taskId: null },
        { stopId: "send", state: "upcoming", current: false },
      ],
    });
    expect(await taskLine(human, { taskId: started.run.taskId! })).toMatchObject({ role: "run", stops: [{ current: false }, { current: false }, { current: false }] });
    const [plain] = (await captureTasks(human, { tasks: [{ title: "Not on a line" }] })).created;
    expect(await taskLine(human, { taskId: plain!.id })).toBeNull();
  });
});

describe("run names", () => {
  it("names a run, its task and its notes, keeps the name on a rerun, and renames or clears it", async () => {
    const { pipeline } = await define(human, [agentStop("draft", "Scout", { end: "done" }, { instructions: "Write {{run.number}}." })]);
    const named = await startRun(human, { pipelineId: pipeline.id, name: "  Issue 42: AI agents roundup " });
    expect(named.run.name).toBe("Issue 42: AI agents roundup");
    expect(named.run.task?.title).toBe("Issue 42: AI agents roundup");
    const draft = (await getTask(scout, { taskId: stopIn(named, "draft").task!.id })).task;
    expect(draft.description).toContain("Issue 42: AI agents roundup (Newsletter #1)");

    const plain = await startRun(human, { pipelineId: pipeline.id });
    expect(plain.run).toMatchObject({ name: null, task: { title: "Newsletter #2" } });

    await completeTask(scout, { taskId: draft.id, note: "Done" });
    const rerun = await rerunFrom(human, { runId: named.run.id, stopId: "draft", note: "Again" });
    expect(rerun.run.name).toBe("Issue 42: AI agents roundup");

    const renamed = await updateRun(scout, { runId: plain.run.id, name: "Acme Q3 renewal email" });
    expect(renamed.run).toMatchObject({ name: "Acme Q3 renewal email", task: { title: "Acme Q3 renewal email" } });
    await expect(updateRun(human, { runId: plain.run.id, name: "Acme Q3 renewal email" })).rejects.toMatchObject({ code: "invalid" });
    await expect(updateRun(human, { runId: plain.run.id })).rejects.toMatchObject({ code: "invalid" });
    // The run's task is renamed through the task service, so its watchers hear it.
    const taskEvents = (await listActivity(human, { limit: 100 })).filter((event) => event.action === "task.updated" && event.entityId === plain.run.task!.id);
    expect(taskEvents[0]).toMatchObject({ summary: expect.stringContaining("Acme Q3 renewal email"), data: expect.objectContaining({ changed: ["title"] }) });
    // Kept to one line, as at start (the schema already holds it to the limit).
    const clipped = await updateRun(human, { runId: plain.run.id, name: "Acme\n  Q3 renewal" });
    expect(clipped.run.name).toBe("Acme Q3 renewal");
    await updateRun(human, { runId: plain.run.id, name: "Acme Q3 renewal email" });
    const cleared = await updateRun(human, { runId: plain.run.id, name: null });
    expect(cleared.run).toMatchObject({ name: null, task: { title: "Newsletter #2" } });
    expect((await listActivity(human, { limit: 50 })).map((event) => event.action)).toContain("pipeline.run_renamed");
    expect((await listPipelineBoard(human, {}))[0]!.strip.map((run) => run.name)).toEqual([null, "Issue 42: AI agents roundup"]);
  });

  it("names a run an event starts after the captured task, and a scheduled one after its day", async () => {
    const { pipeline } = await define(human, [agentStop("one", "Scout", { end: "done" })], { triggers: { events: [{ tag: "launch" }], schedule: { cron: "0 9 * * 1", timeZone: "Europe/Berlin" } } });
    await captureTasks(scout, { tasks: [{ title: "Launch the partner portal", tags: ["launch"] }] });
    const [fromEvent] = await listRuns(human, { pipelineId: pipeline.id });
    expect(fromEvent!.name).toBe("Launch the partner portal");

    const [trigger] = await testDb.db.select().from(pipelineTriggers).where(and(eq(pipelineTriggers.pipelineId, pipeline.id), eq(pipelineTriggers.kind, "schedule")));
    await testDb.db.update(pipelineTriggers).set({ checkedAt: new Date("2026-11-30T07:30:00Z") }).where(eq(pipelineTriggers.id, trigger!.id));
    expect(await fireSchedule(systemContext(testDb.db, ws.tenant), trigger!.id, new Date("2026-11-30T08:05:00Z"))).toBe(true);
    const runs = await listRuns(human, { pipelineId: pipeline.id });
    expect(runs.find((entry) => entry.trigger === "schedule")!.name).toBe("Newsletter, 2026-11-30");
  });

  it("shows the run's name beside a person stop's decision and on the task's line", async () => {
    const { pipeline } = await define(human, [{ id: "review", name: "Review", kind: "person", person: ws.human.actor.id, options: ["Yes", "No"], then: { end: "done" } }]);
    const started = await startRun(human, { pipelineId: pipeline.id, name: "Acme Q3 renewal email" });
    const taskId = stopIn(started, "review").task!.id;
    const { task } = await getTask(human, { taskId });
    expect(task.inputRequest?.pipeline).toMatchObject({ runName: "Acme Q3 renewal email", runNumber: 1 });
    const contexts = await describePipelineRequests(human, { requests: [{ runId: started.run.id, stopId: "review" }] });
    expect(contexts[`${started.run.id}:review`]).toMatchObject({ runName: "Acme Q3 renewal email", position: { index: 1, total: 1 } });
    expect((await taskLine(human, { taskId }))?.run.name).toBe("Acme Q3 renewal email");
  });
});

describe("resending handoffs no one picked up", () => {
  const MINUTE = 60_000;
  const retriesOf = async (taskId: string) =>
    (await listActivity(human, { limit: 100 })).filter((event) => event.action === "task.handoff_retried" && event.entityId === taskId);

  /** Moves a stop's handoff back in time, as the clock would: the row's handoff and its task's delegation alike. */
  async function backdateHandoff(taskId: string, minutes: number) {
    const shift = sql`interval '1 minute' * ${minutes}`;
    await testDb.db.update(pipelineRunStops).set({ handedOffAt: sql`${pipelineRunStops.handedOffAt} - ${shift}` }).where(eq(pipelineRunStops.taskId, taskId));
    await testDb.db.update(tasks).set({ delegatedAt: sql`${tasks.delegatedAt} - ${shift}` }).where(eq(tasks.id, taskId));
  }

  async function handedToScout() {
    const { pipeline } = await define(human, [agentStop("draft", "Scout", { end: "done" }, { instructions: "Draft it." })]);
    const started = await startRun(human, { pipelineId: pipeline.id, name: "Issue 7" });
    const stop = stopIn(started, "draft");
    return { started, taskId: stop.task!.id, at: stop.handoff!.handedOffAt };
  }

  it("resends at 3, 6, 12 … minutes, once each however many sweeps overlap, with why and how often", async () => {
    const { started, taskId, at } = await handedToScout();
    expect(stopIn(started, "draft").handoff).toMatchObject({ resends: 0, stuck: false, nextRetryAt: new Date(at.getTime() + 3 * MINUTE) });

    // The sweep covers every workspace, so these count this run's resends in its own activity.
    await sweepHandoffRetries(testDb.db, new Date(at.getTime() + 2 * MINUTE));
    expect(await retriesOf(taskId)).toHaveLength(0);
    const due = new Date(at.getTime() + 3 * MINUTE);
    // Two ticks at once. PGlite runs one connection, so this shows the due time is re-read and moved on
    // under the lock (the second finds nothing due), not that Postgres's row locks serialize real ticks.
    await Promise.all([sweepHandoffRetries(testDb.db, due), sweepHandoffRetries(testDb.db, due)]);
    expect(await retriesOf(taskId)).toHaveLength(1);
    await sweepHandoffRetries(testDb.db, new Date(at.getTime() + 5 * MINUTE));
    expect(await retriesOf(taskId)).toHaveLength(1);
    await sweepHandoffRetries(testDb.db, new Date(at.getTime() + 12 * MINUTE + 5_000));

    const sent = await retriesOf(taskId);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.data).toMatchObject({
      retry: true,
      retryCount: 2,
      reason: "not picked up 12 minutes after the handoff",
      trigger: "automatic",
      taskId,
      runId: started.run.id,
      stopId: "draft",
      runName: "Issue 7",
      toAgentId: ws.scout.ctx.actor.id,
      note: expect.stringContaining("Draft it."),
    });
    expect(sent[1]!.data).toMatchObject({ retryCount: 1, reason: "not picked up 3 minutes after the handoff" });
    // A late tick sends once and moves on to the next time still ahead: 24 minutes.
    const view = await run(started.run.id);
    expect(stopIn(view, "draft").handoff).toMatchObject({ resends: 2, nextRetryAt: new Date(at.getTime() + 24 * MINUTE) });
  });

  it("stops when the agent picks the stop up, and reads it as stuck only until then", async () => {
    const { started, taskId, at } = await handedToScout();
    await sweepHandoffRetries(testDb.db, new Date(at.getTime() + 3 * MINUTE));
    expect(await listStuckStops(human, {})).toEqual([]);
    await backdateHandoff(taskId, 10);
    const stuck = await listStuckStops(human, {});
    expect(stuck).toEqual([expect.objectContaining({ runId: started.run.id, stopId: "draft", runName: "Issue 7", resends: 1, agent: { id: ws.scout.ctx.actor.id, name: "Scout" } })]);
    expect(stopIn(await run(started.run.id), "draft").handoff?.stuck).toBe(true);

    await claimTask(scout, { taskId });
    await sweepHandoffRetries(testDb.db, new Date(at.getTime() + 6 * MINUTE));
    await sweepHandoffRetries(testDb.db, new Date(at.getTime() + 60 * MINUTE));
    expect(await retriesOf(taskId)).toHaveLength(1);
    expect(await listStuckStops(human, {})).toEqual([]);
    expect(stopIn(await run(started.run.id), "draft").handoff).toMatchObject({ stuck: false, nextRetryAt: null, resends: 1 });
  });

  it("gives up after 3 days, leaving the stop stuck for a person", async () => {
    const { started, taskId, at } = await handedToScout();
    for (let minutes = 3; minutes < 3 * 24 * 60; minutes *= 2) await sweepHandoffRetries(testDb.db, new Date(at.getTime() + minutes * MINUTE));
    expect(await retriesOf(taskId)).toHaveLength(11);
    await sweepHandoffRetries(testDb.db, new Date(at.getTime() + 3 * 24 * 60 * MINUTE));
    await sweepHandoffRetries(testDb.db, new Date(at.getTime() + 4 * 24 * 60 * MINUTE));
    expect(await retriesOf(taskId)).toHaveLength(11);
    await backdateHandoff(taskId, 3 * 24 * 60);
    const view = await run(started.run.id);
    expect(stopIn(view, "draft")).toMatchObject({ state: "active", handoff: { stuck: true, resends: 11, nextRetryAt: null, gaveUpAt: expect.any(Date) } });
    expect((await listActivity(human, { limit: 100 })).filter((event) => event.action === "pipeline.stop_stuck")).toHaveLength(1);
    expect((await listStuckStops(human, {}))[0]).toMatchObject({ gaveUpAt: expect.any(Date) });
  });

  it("resends by hand while the handoff waits, without moving the schedule, and refuses once it does not", async () => {
    const { started, taskId, at } = await handedToScout();
    const resent = await resendHandoff(human, { runId: started.run.id, stopId: "draft" });
    expect(resent).toMatchObject({ taskId, agentName: "Scout", stopName: "draft", retryCount: 1 });
    expect((await retriesOf(taskId))[0]!.data).toMatchObject({ trigger: "manual", reason: "resent by Dana", resentBy: { type: "user", name: "Dana" }, retryCount: 1, note: expect.stringContaining("Draft it.") });
    expect(stopIn(await run(started.run.id), "draft").handoff).toMatchObject({ nextRetryAt: new Date(at.getTime() + 3 * MINUTE), waiting: true, agent: { name: "Scout" } });

    // Picked up, then done: nothing waits, so there is nothing to resend.
    await claimTask(scout, { taskId });
    await expect(resendHandoff(human, { runId: started.run.id, stopId: "draft" })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("already picked up") });
    await completeTask(scout, { taskId, note: "Done" });
    await expect(resendHandoff(human, { runId: started.run.id, stopId: "draft" })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("is done") });
    expect(await retriesOf(taskId)).toHaveLength(1);

    const { pipeline } = await define(human, [{ id: "ok", name: "OK", kind: "person", person: ws.human.actor.id, then: { end: "done" } }]);
    const personRun = await startRun(human, { pipelineId: pipeline.id });
    await expect(resendHandoff(human, { runId: personRun.run.id, stopId: "ok" })).rejects.toMatchObject({ code: "invalid" });
    await expect(resendHandoff(leeCtx, { runId: started.run.id, stopId: "nope" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses a manual resend once the stop's task is handed to someone else", async () => {
    const { started, taskId } = await handedToScout();
    await handOffTask(human, { taskId, toAgent: "Closer", note: "Closer takes this one" });
    await expect(resendHandoff(human, { runId: started.run.id, stopId: "draft" })).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("now being handed to Closer"),
    });
    expect(await retriesOf(taskId)).toEqual([]);
  });

  it("resends only to the agent the task was handed to, and leaves the stop stuck for a person once it cannot act", async () => {
    const { started, taskId, at } = await handedToScout();
    await revokeAgent(human, { agentId: ws.scout.ctx.actor.id });
    // Another agent of the same name is not the one the task waits on.
    await createAgent(human, { name: "Scout" });
    await expect(resendHandoff(human, { runId: started.run.id, stopId: "draft" })).rejects.toMatchObject({ code: "conflict", message: expect.stringContaining("can no longer act") });
    await sweepHandoffRetries(testDb.db, new Date(at.getTime() + 3 * MINUTE));
    expect(await retriesOf(taskId)).toEqual([]);
    const stuck = (await listActivity(human, { limit: 100 })).filter((event) => event.action === "pipeline.stop_stuck");
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.data).toMatchObject({ reason: expect.stringContaining("can no longer act") });
    expect(stopIn(await run(started.run.id), "draft").handoff).toMatchObject({ nextRetryAt: null, gaveUpAt: expect.any(Date), agent: null });
  });

  it("lists stuck stops by the stuck rule before the limit, so handoffs that moved on never crowd them out", async () => {
    const moved = await handedToScout();
    const stuck = await handedToScout();
    // The older one was handed on to Closer by a person: still handing off, but no longer the run's handoff.
    await handOffTask(human, { taskId: moved.taskId, toAgent: "Closer" });
    await backdateHandoff(moved.taskId, 60);
    await backdateHandoff(stuck.taskId, 10);
    expect((await listStuckStops(human, { limit: 1 })).map((stop) => stop.runId)).toEqual([stuck.started.run.id]);
  });

  it("puts off a row whose resend fails, and goes on with the rest", async () => {
    const bad = await handedToScout();
    const good = await handedToScout();
    // A stop its run's definition no longer has: resending it throws.
    await testDb.db.update(pipelineRunStops).set({ stopId: "ghost" }).where(eq(pipelineRunStops.taskId, bad.taskId));
    const due = new Date(good.at.getTime() + 3 * MINUTE);
    await sweepHandoffRetries(testDb.db, due);
    expect(await retriesOf(good.taskId)).toHaveLength(1);
    const [row] = await testDb.db.select({ retryAt: pipelineRunStops.handoffRetryAt }).from(pipelineRunStops).where(eq(pipelineRunStops.taskId, bad.taskId));
    expect(row!.retryAt!.getTime()).toBeGreaterThan(due.getTime());
  });

  it("reaches the agent it was handed to, and the parent of a sub-agent, as handed_to_you", async () => {
    vi.stubEnv("PHEAN_WEBHOOK_ALLOW_PRIVATE", "1");
    onTestFinished(() => void vi.unstubAllEnvs());
    const { agent, token } = await createSubagent(scout, { name: "Scout Writer" });
    const writer = agentContext(testDb.db, (await authenticateAgentToken(testDb.db, token))!);
    await registerWebhook(scout, { url: "https://hooks.example.com/scout", topics: ["decisions"] });
    await registerWebhook(writer, { url: "https://hooks.example.com/writer", topics: ["decisions"] });
    await registerWebhook(closer, { url: "https://hooks.example.com/closer", topics: ["decisions"] });
    const { pipeline } = await define(human, [agentStop("draft", "Scout Writer", { end: "done" })]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    await resendHandoff(human, { runId: started.run.id, stopId: "draft" });

    const queued = await testDb.db
      .select({ hook: webhooks.agentId, reasons: webhookDeliveries.reasons, forAgents: webhookDeliveries.forAgents })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      .innerJoin(events, eq(events.id, webhookDeliveries.eventId))
      .where(eq(events.action, "task.handoff_retried"));
    expect(queued).toEqual(
      expect.arrayContaining([
        { hook: agent.id, reasons: ["handed_to_you"], forAgents: null },
        { hook: ws.scout.ctx.actor.id, reasons: ["handed_to_you"], forAgents: [{ id: agent.id, name: "Scout Writer" }] },
      ]),
    );
    expect(queued.some((row) => row.hook === ws.closer.ctx.actor.id)).toBe(false);
  });
});

describe("bot names on the line", () => {
  it("shows an agent stop's agent by its name now, named by id or by name, and plain text once it is gone", async () => {
    const { pipeline } = await define(human, [agentStop("one", ws.scout.ctx.actor.id, { next: "two" }), agentStop("two", "closer", { end: "done" })]);
    const started = await startRun(human, { pipelineId: pipeline.id });
    expect(stopIn(started, "one")).toMatchObject({ servedBy: "Scout", agent: { id: ws.scout.ctx.actor.id, name: "Scout" } });
    expect(stopIn(started, "two")).toMatchObject({ servedBy: "Closer", agent: { id: ws.closer.ctx.actor.id, name: "Closer" } });
    await revokeAgent(human, { agentId: ws.closer.ctx.actor.id });
    expect(stopIn(await run(started.run.id), "two")).toMatchObject({ servedBy: "closer", agent: null });
  });
});

describe("migration 0023", () => {
  it("runs again over its own columns and index, as a preview sharing the database may have run it first", async () => {
    const { readFileSync } = await import("node:fs");
    const statements = readFileSync(new URL("../drizzle/0023_run_names_handoff_retries.sql", import.meta.url), "utf8").split("--> statement-breakpoint");
    for (const statement of statements) await testDb.db.execute(sql.raw(statement));
    const { pipeline } = await define(human, [agentStop("draft", "Scout", { end: "done" })]);
    expect((await startRun(human, { pipelineId: pipeline.id, name: "Still works" })).run.name).toBe("Still works");
  });
});
