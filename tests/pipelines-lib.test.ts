import { describe, expect, it } from "vitest";

import {
  cronProblem,
  definitionProblems,
  latestFiring,
  matchBranch,
  normalizeDefinition,
  planRun,
  renderTemplate,
  rollUp,
  stopOrder,
  type PipelineDefinition,
  type PipelineStop,
  type StopProgress,
} from "@/lib/pipelines";
import { PipelineDefinitionInput } from "@/server/domain/schemas";

const stop = (id: string, then: PipelineStop["then"], extra: Partial<PipelineStop> = {}): PipelineStop => ({
  id,
  name: id,
  kind: "agent",
  agent: "Scout",
  approvals: 1,
  options: [],
  blocking: true,
  instructions: "",
  outputs: [],
  onFailure: { action: "fail", times: 1 },
  then,
  ...extra,
});

const definition = (stops: PipelineStop[], ends = ["done"]): PipelineDefinition => ({ start: stops[0]!.id, inputs: [], stops, ends: ends.map((id) => ({ id, name: id })) });
const progress = (entries: Record<string, StopProgress["state"] | [StopProgress["state"], string]>) =>
  new Map(Object.entries(entries).map(([id, value]) => [id, Array.isArray(value) ? { state: value[0], branch: value[1] } : { state: value, branch: null }]));

const forkJoin = (join: "all" | "first") =>
  definition([stop("start", { fork: ["a", "b"] }), stop("a", { next: "c" }), stop("b", { next: "c" }), stop("c", { end: "done" }, { join })]);

describe("pipeline definitions", () => {
  it("accepts a well-formed line", () => {
    expect(definitionProblems(forkJoin("all"))).toEqual([]);
  });

  it("refuses loops, unreachable stops, dangling targets and unknown template references, in words", () => {
    const looping = definition([stop("a", { next: "b" }), stop("b", { next: "a" })]);
    expect(definitionProblems(looping).join("\n")).toMatch(/form a loop/);
    const stranded = definition([stop("a", { end: "done" }), stop("b", { end: "done" })]);
    expect(definitionProblems(stranded)).toContain('Stop "b" is never reached from the start, "a". Lead to it from another stop, or remove it.');
    expect(definitionProblems(definition([stop("a", { next: "done" })])).join("\n")).toMatch(/To finish there, use then.end: "done"/);
    const templated = definition([stop("a", { next: "b" }, { instructions: "{{stops.b.result}} {{input.topic}}" }), stop("b", { end: "done" })]);
    expect(definitionProblems(templated).join("\n")).toMatch(/"b" does not come before it/);
    expect(definitionProblems(templated).join("\n")).toMatch(/\{\{input.topic\}\}, which Phean does not know/);
  });

  it("checks that a person's options and a choice's labels cover each other", () => {
    const review = stop("review", { choice: [{ label: "Approve", to: "send" }, { label: "Reject", end: "dropped" }] }, { kind: "person", agent: undefined, person: "dana@example.com", options: ["Approve", "Hold"] });
    const problems = definitionProblems(definition([review, stop("send", { end: "done" })], ["done", "dropped"]));
    expect(problems).toContain('Stop "review" offers "Hold", but its choice has no branch with that label.');
    expect(problems).toContain(`Stop "review"'s choice has a branch "Reject" that is not one of its options.`);
    // Left out, a person's options are the choice's labels.
    const filled = normalizeDefinition({ ...definition([{ ...review, options: [] }, stop("send", { end: "done" })], ["done", "dropped"]) });
    expect(filled.stops[0]!.options).toEqual(["Approve", "Reject"]);
    expect(definitionProblems(filled)).toEqual([]);
  });

  it("reserves pipeline stops and keeps person fields on person stops", () => {
    const problems = definitionProblems(definition([stop("a", { end: "done" }, { kind: "pipeline", agent: undefined }), stop("b", { end: "done" }, { options: ["x"] })]));
    expect(problems.join("\n")).toMatch(/reserved for factories/);
  });

  it("reports every problem through the input schema, so an agent fixes them in one go", () => {
    const result = PipelineDefinitionInput.safeParse({ stops: [{ id: "a", name: "A", kind: "agent", then: { next: "nowhere" } }], ends: [{ id: "done", name: "Done" }] });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining(['Stop "a" is an agent stop: name the agent (its name or id) in agent.', 'Stop "a" goes next to "nowhere", which is not a stop.']),
    );
  });

  it("orders stops the way a run meets them", () => {
    expect(stopOrder(forkJoin("all"))).toEqual(["start", "a", "b", "c"]);
  });
});

describe("planning a run", () => {
  it("reaches the start, then each stop once its stop before it is done", () => {
    const line = definition([stop("a", { next: "b" }), stop("b", { end: "done" })]);
    expect(planRun(line, new Map()).reach).toEqual(["a"]);
    expect(planRun(line, progress({ a: "active" })).reach).toEqual([]);
    expect(planRun(line, progress({ a: "done" })).reach).toEqual(["b"]);
    expect(rollUp(line, progress({ a: "done", b: "done" }))).toBe("done");
  });

  it("joins all branches, or goes on with the first and cancels what leads only to the join", () => {
    expect(planRun(forkJoin("all"), progress({ start: "done", a: "done", b: "active" })).reach).toEqual([]);
    expect(planRun(forkJoin("all"), progress({ start: "done", a: "done", b: "done" })).reach).toEqual(["c"]);
    expect(planRun(forkJoin("first"), progress({ start: "done", a: "done", b: "active" }))).toMatchObject({ reach: ["c"], cancel: ["b"] });
  });

  it("skips the branches a choice did not take, and joins what is left", () => {
    const choosing = definition([
      stop("review", { choice: [{ label: "yes", to: "send" }, { label: "no", to: "fix" }] }),
      stop("fix", { next: "notify" }),
      stop("send", { next: "notify" }),
      stop("notify", { end: "done" }),
    ]);
    expect(planRun(choosing, progress({ review: ["done", "yes"] }))).toMatchObject({ reach: ["send"], skip: ["fix"] });
    expect(planRun(choosing, progress({ review: ["done", "yes"], fix: "skipped", send: "done" })).reach).toEqual(["notify"]);
  });

  it("never fails a run while a branch is alive, and lets waiting on a person win", () => {
    const failedBranch = progress({ start: "done", a: "failed", b: "active" });
    expect(planRun(forkJoin("all"), failedBranch).notReach).toEqual(["c"]);
    expect(rollUp(forkJoin("all"), failedBranch)).toBe("running");
    expect(rollUp(forkJoin("all"), progress({ start: "done", a: "failed", b: "waiting" }))).toBe("waiting");
    expect(rollUp(forkJoin("all"), progress({ start: "done", a: "failed", b: "done", c: "not_reached" }))).toBe("failed");
  });
});

describe("choosing a branch from a result", () => {
  const branches = [{ label: "approved" }, { label: "approved with changes" }, { label: "rejected" }];
  it("takes the label the note is, or starts with, the longest first", () => {
    expect(matchBranch(branches, "Approved.")?.label).toBe("approved");
    expect(matchBranch(branches, "approved with changes: fix the title")?.label).toBe("approved with changes");
    expect(matchBranch(branches, "**Rejected**\nToo long")?.label).toBe("rejected");
  });
  it("picks nothing from a label mentioned later, or a word that only begins like one", () => {
    expect(matchBranch(branches, "Not approved")).toBeNull();
    expect(matchBranch(branches, "approvedish")).toBeNull();
  });
});

describe("templates", () => {
  it("fills inputs, results and the run's number, and says (none) for what is missing", () => {
    const scope = { input: { topic: "AI" }, stops: { draft: { result: "A draft", answer: "" } }, run: { number: 3 }, pipeline: { name: "Weekly" } };
    expect(renderTemplate("{{pipeline.name}} #{{run.number}} on {{ input.topic }}: {{stops.draft.result}} / {{stops.draft.answer}}", scope)).toBe("Weekly #3 on AI: A draft / (none)");
  });
});

describe("schedules", () => {
  it("allows at most one run an hour, and says why a cron is wrong", () => {
    expect(cronProblem("0 9 * * 1")).toBeNull();
    expect(cronProblem("*/5 * * * *")).toMatch(/more than once an hour/);
    expect(cronProblem("0 25 * * *")).toMatch(/not a valid hour/);
    expect(cronProblem("0 9 * *")).toMatch(/needs five fields/);
  });

  it("finds the latest firing in a time zone, once per scheduled time", () => {
    // Mondays at 9:00 in Berlin (UTC+1 in November) is 08:00 UTC.
    const monday = new Date("2026-11-23T08:00:30Z");
    expect(latestFiring("0 9 * * mon", "Europe/Berlin", new Date("2026-11-23T07:00:00Z"), monday)?.toISOString()).toBe("2026-11-23T08:00:00.000Z");
    expect(latestFiring("0 9 * * mon", "Europe/Berlin", new Date("2026-11-23T08:00:00Z"), monday)).toBeNull();
    expect(latestFiring("0 9 * * mon", "Europe/Berlin", new Date("2026-11-23T07:00:00Z"), new Date("2026-11-23T07:59:00Z"))).toBeNull();
  });
});
