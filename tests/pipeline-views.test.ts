import { describe, expect, it } from "vitest";

import { formatDuration } from "@/lib/format";
import { addStopAfter, choiceAt, forkAt, joinsOf, moveStop, removeStop, tidyJoins } from "@/lib/pipeline-edit";
import { edgeRunState, edgesOf, lineMap, stopViewState } from "@/lib/pipeline-map";
import { definitionDiff, focusStopOf, nextFiring, nextStepFor, percentile, pipelineInsights, runGrid, runTracks, stopPosition, type RunRecord } from "@/lib/pipeline-stats";
import { PIPELINE_TEMPLATE_META, PIPELINE_TEMPLATES } from "@/lib/pipeline-templates";
import { definitionProblems, normalizeDefinition, type PipelineDefinition, type PipelineStop } from "@/lib/pipelines";

const stop = (id: string, then: PipelineStop["then"], extra: Partial<PipelineStop> = {}): PipelineStop => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
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

const def = (stops: PipelineStop[], ends = ["done"]): PipelineDefinition => ({ start: stops[0]!.id, inputs: [], stops, ends: ends.map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) })) });

const linear = def([stop("research", { next: "draft" }), stop("draft", { next: "review" }), stop("review", { end: "done" })]);
const forked = def([stop("start", { fork: ["left", "right"] }), stop("left", { next: "merge" }), stop("right", { next: "merge" }), stop("merge", { end: "done" })]);
const choosing = def(
  [
    stop("draft", { next: "review" }),
    stop("review", { choice: [{ label: "Approve", to: "send" }, { label: "Drop", end: "dropped" }], default: "Drop" }, { kind: "person", agent: undefined, role: "member", options: ["Approve", "Drop"] }),
    stop("send", { end: "sent" }),
  ],
  ["sent", "dropped"],
);

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 9, 0) + minutes * 60_000);

describe("the line map", () => {
  it("lays a linear line out on one row, its end one column after the last stop", () => {
    const map = lineMap(linear);
    expect(map.nodes.map((node) => [node.kind, node.id, node.col, node.row])).toEqual([
      ["stop", "research", 0, 0],
      ["stop", "draft", 1, 0],
      ["stop", "review", 2, 0],
      ["end", "done", 3, 0],
    ]);
    expect(map).toMatchObject({ cols: 4, rows: 1 });
    expect(map.edges).toHaveLength(3);
  });

  it("stacks a fork's second branch below and brings the join back to the main row, after both branches", () => {
    const map = lineMap(forked);
    const where = Object.fromEntries(map.nodes.map((node) => [node.id, [node.col, node.row]]));
    expect(where).toEqual({ start: [0, 0], left: [1, 0], right: [1, 1], merge: [2, 0], done: [3, 0] });
    expect(map.nodes.find((node) => node.id === "merge")).toMatchObject({ join: "all" });
    expect(map.rows).toBe(2);
  });

  it("labels a choice's edges, marks its default, and gives each end its own place", () => {
    const map = lineMap(choosing);
    expect(map.edges.filter((edge) => edge.kind === "choice")).toEqual([
      { from: "review", to: "send", toKind: "stop", kind: "choice", label: "Approve" },
      { from: "review", to: "dropped", toKind: "end", kind: "choice", label: "Drop", isDefault: true },
    ]);
    const cells = new Set(map.nodes.map((node) => `${node.col}:${node.row}`));
    expect(cells.size).toBe(map.nodes.length);
    expect(map.nodes.find((node) => node.id === "dropped")).toMatchObject({ col: 2, row: 1 });
  });

  it("reads each edge for a run: travelled, skipped or still pending", () => {
    const [toSend, toDropped] = edgesOf(choosing.stops[1]!);
    const done = { state: "done" as const, branch: "approve" };
    expect(edgeRunState(toSend!, done)).toBe("travelled");
    expect(edgeRunState(toDropped!, done)).toBe("skipped");
    expect(edgeRunState(toSend!, { state: "waiting", branch: null })).toBe("pending");
    expect(edgeRunState(toSend!, { state: "skipped", branch: null })).toBe("skipped");
    expect(edgeRunState(toSend!, undefined)).toBe("pending");
  });

  it("shows an active stop nobody has picked up as handing off", () => {
    expect(stopViewState("active", "todo")).toBe("handing_off");
    expect(stopViewState("active", "in_progress")).toBe("active");
    expect(stopViewState("waiting", "todo")).toBe("waiting");
    expect(stopViewState("upcoming", null)).toBe("upcoming");
  });
});

const row = (stopId: string, state: RunRecord["stops"][number]["state"], from: number, to: number | null, extra: Partial<RunRecord["stops"][number]> = {}) => ({
  stopId,
  state,
  attempt: 1,
  startedAt: at(from),
  endedAt: to === null ? null : at(to),
  superseded: false,
  branch: null,
  taskStatus: null,
  ...extra,
});

const runs: RunRecord[] = [
  { id: "r_1", number: 1, version: 1, status: "done", startedAt: at(0), endedAt: at(60), endName: "Sent", stops: [row("draft", "done", 0, 20), row("review", "done", 20, 50, { branch: "Approve" }), row("send", "done", 50, 60)] },
  {
    id: "r_2",
    number: 2,
    version: 1,
    status: "done",
    startedAt: at(100),
    endedAt: at(220),
    endName: "Sent",
    stops: [row("draft", "failed", 100, 110, { superseded: true }), row("draft", "done", 110, 140), row("review", "done", 140, 200, { branch: "Approve" }), row("send", "done", 200, 220)],
  },
  { id: "r_3", number: 3, version: 1, status: "failed", startedAt: at(300), endedAt: at(310), endName: null, stops: [row("draft", "failed", 300, 310), row("review", "not_reached", 310, 310)] },
  { id: "r_4", number: 4, version: 1, status: "waiting", startedAt: at(400), endedAt: null, endName: null, stops: [row("draft", "done", 400, 410), row("review", "waiting", 410, null)] },
];

describe("runs and insights", () => {
  it("takes percentiles by nearest rank", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 0.9)).toBe(9);
  });

  it("draws runs × stops newest first, with each cell's state, time and attempts", () => {
    const grid = runGrid(choosing, runs, at(500));
    expect(grid.runs.map((run) => run.number)).toEqual([4, 3, 2, 1]);
    expect(grid.stops.map((entry) => entry.id)).toEqual(["draft", "review", "send"]);
    expect(grid.cells.draft!.map((cell) => cell.state)).toEqual(["done", "failed", "done", "done"]);
    expect(grid.cells.draft![2]).toMatchObject({ attempts: 2, durationMs: 30 * 60_000 });
    expect(grid.cells.review!.map((cell) => cell.state)).toEqual(["waiting", "not_reached", "done", "done"]);
    expect(grid.cells.review![0]!.durationMs).toBe(90 * 60_000);
    expect(grid.cells.send![0]).toMatchObject({ state: "upcoming", durationMs: null, attempts: 0 });
  });

  it("works out success, trip times, per-stop times, waits and flaky stops", () => {
    const insights = pipelineInsights(choosing, runs, at(500));
    expect(insights).toMatchObject({ finished: 3, succeeded: 2, tripP50: 60 * 60_000, tripP90: 120 * 60_000 });
    expect(insights.successRate).toBeCloseTo(2 / 3);
    expect(insights.stops.find((entry) => entry.id === "draft")).toMatchObject({ count: 3, p50: 20 * 60_000, p90: 30 * 60_000 });
    expect(insights.waits).toEqual([{ id: "review", name: "Review", p50: 60 * 60_000, p90: 90 * 60_000, waiting: 1 }]);
    expect(insights.flaky).toEqual([{ id: "draft", name: "Draft", flaky: 1, reached: 4 }]);
    expect(insights.trend.map((entry) => [entry.number, entry.share])).toEqual([
      [1, 0.5],
      [2, 1],
      [3, 10 / 120],
    ]);
  });

  it("places one run's stops on an axis from its start to now", () => {
    const run = runs[3]!;
    const { tracks, spanMs } = runTracks(run, [...run.stops, { stopId: "send", state: "upcoming", startedAt: null, endedAt: null }], at(420));
    expect(spanMs).toBe(20 * 60_000);
    expect(tracks).toEqual([
      { stopId: "draft", from: 0, to: 0.5, open: false },
      { stopId: "review", from: 0.5, to: 1, open: true },
    ]);
  });

  it("opens a run on what waits on a person, else a failure, else the live stop", () => {
    expect(focusStopOf([{ stopId: "a", state: "failed" }, { stopId: "b", state: "waiting" }])).toBe("b");
    expect(focusStopOf([{ stopId: "a", state: "active" }, { stopId: "b", state: "failed" }])).toBe("b");
    expect(focusStopOf([{ stopId: "a", state: "done" }, { stopId: "b", state: "upcoming" }])).toBe("a");
  });
});

describe("schedules, versions and person stops", () => {
  it("finds a schedule's next firing in its time zone", () => {
    // Mondays at 9:00 in Berlin (UTC+1 in November): Monday 2 November 2026, 08:00 UTC.
    expect(nextFiring("0 9 * * 1", "Europe/Berlin", new Date(Date.UTC(2026, 9, 31, 12)))?.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(nextFiring("30 * * * *", "Asia/Kolkata", new Date(Date.UTC(2026, 10, 1, 10, 5)))?.toISOString()).toBe("2026-11-01T11:00:00.000Z");
    expect(nextFiring("0 9 31 2 *", "UTC", new Date(Date.UTC(2026, 0, 1)))).toBeNull();
    expect(nextFiring("not cron", "UTC", new Date())).toBeNull();
  });

  it("says what changed between versions", () => {
    const after = def([stop("research", { next: "draft" }, { agent: "Closer" }), stop("draft", { end: "done" }, { timeLimitMinutes: 60 })], ["done", "held"]);
    expect(definitionDiff(linear, after)).toEqual([
      '"Research" is served by agent Closer instead of agent Scout.',
      '"Draft" ends at done (was: then review).',
      '"Draft" has a time limit of 60 minutes (was none).',
      'Removed the stop "Review".',
      'Added the end "Held".',
    ]);
    expect(definitionDiff(linear, linear)).toEqual([]);
  });

  it("says where each answer leads, and where a stop sits on the line", () => {
    expect(nextStepFor(choosing, "review", "approve")).toMatchObject({ kind: "stop", stop: { id: "send" } });
    expect(nextStepFor(choosing, "review", "Drop")).toEqual({ kind: "end", name: "Dropped" });
    expect(nextStepFor(choosing, "review", "Maybe")).toBeNull();
    expect(nextStepFor(choosing, "draft", "anything")).toMatchObject({ kind: "stop", stop: { id: "review" } });
    expect(nextStepFor(forked, "start", "")).toMatchObject({ kind: "fork", stops: [{ id: "left" }, { id: "right" }] });
    expect(stopPosition(choosing, "review")).toEqual({ index: 2, total: 3 });
    expect(stopPosition(choosing, "nope")).toBeNull();
  });

  it("formats durations to two units at most", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(185 * 60_000)).toBe("3 h 5 min");
    expect(formatDuration(52 * 3600_000)).toBe("2 d 4 h");
  });
});

describe("the editor's moves", () => {
  const valid = (definition: PipelineDefinition) => expect(definitionProblems(normalizeDefinition(definition))).toEqual([]);

  it("starts every template as a valid line", () => {
    for (const key of PIPELINE_TEMPLATES) valid(PIPELINE_TEMPLATE_META[key].definition);
  });

  it("adds a stop after another, which takes over what came after it", () => {
    const next = addStopAfter(linear, "draft");
    expect(next.stops.map((entry) => entry.id)).toEqual(["research", "draft", "stop", "review"]);
    expect(next.stops[1]!.then).toEqual({ next: "stop" });
    expect(next.stops[2]!.then).toEqual({ next: "review" });
    valid(next);
  });

  it("forks at a stop, turning what came next into a join", () => {
    const next = forkAt(linear, "research");
    expect(next.stops[0]!.then).toEqual({ fork: ["branch", "branch_2"] });
    expect(joinsOf(next)).toEqual(new Set(["draft"]));
    valid(next);
  });

  it("adds a choice at a stop, its second branch ending the run", () => {
    const next = choiceAt(linear, "review");
    expect(next.stops.find((entry) => entry.id === "review")!.then).toEqual({ choice: [{ label: "Yes", to: "stop" }, { label: "No", end: "done" }] });
    valid(next);
  });

  it("removes a stop and reconnects what led to it", () => {
    const next = removeStop(linear, "draft");
    expect(next.stops.map((entry) => entry.then)).toEqual([{ next: "review" }, { end: "done" }]);
    valid(next);
    const unforked = tidyJoins(removeStop(forked, "right"));
    expect(unforked.stops[0]!.then).toEqual({ next: "left" });
    valid(unforked);
    expect(removeStop(def([stop("only", { end: "done" })]), "only").stops).toHaveLength(1);
  });

  it("reorders stops without changing the line", () => {
    const moved = moveStop(linear, "review", -1);
    expect(moved.stops.map((entry) => entry.id)).toEqual(["research", "review", "draft"]);
    expect(moveStop(linear, "research", -1)).toBe(linear);
    valid(moved);
  });
});
