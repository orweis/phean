import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pipelineTriggers } from "@/server/db/schema";
import type { Ctx } from "@/server/domain/context";
import { listActivity } from "@/server/domain/events";
import { fireSchedule, sweepDeadlines, systemContext } from "@/server/domain/pipeline-engine";
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
  pausePipeline,
  rejectPipelineVersion,
  rerunFrom,
  startRun,
  updatePipeline,
  type RunView,
} from "@/server/domain/pipelines";
import { answerInput, captureTasks, claimTask, completeTask, getTask, handOffTask, listTasks, releaseTask, updateTask } from "@/server/domain/tasks";
import { handlePipelineTrigger, PIPELINE_TRIGGER_LIMIT } from "@/server/pipelines/trigger";

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
