/**
 * The arithmetic behind the pipeline pages, pure and client-safe: the runs × stops grid, insights
 * (success rate, trip times, per-stop P50 and P90, where people wait, flaky stops), a run's own
 * timeline, the next time a schedule fires, what changed between two versions, and what each answer
 * to a person stop leads to. The pages only lay these out.
 */
import type { RunStatus, StopState, StopViewState } from "./domain";
import { stopViewState } from "./pipeline-map";
import { cronMatches, parseCron, stopOrder, zonedFields, type PipelineDefinition, type PipelineStop } from "./pipelines";

/** One stop row of a run, as the history service reads it. */
export interface RunStopRecord {
  stopId: string;
  state: StopState;
  attempt: number;
  startedAt: Date;
  endedAt: Date | null;
  /** Replaced by a rerun or a hand-back. */
  superseded: boolean;
  branch: string | null;
  taskStatus: string | null;
}

export interface RunRecord {
  id: string;
  number: number;
  /** What the run makes, when it was named. */
  name?: string | null;
  version: number;
  status: RunStatus;
  startedAt: Date;
  endedAt: Date | null;
  endName: string | null;
  stops: RunStopRecord[];
}

/** The value below which `p` (0 to 1) of the values fall, by nearest rank; null for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1]!;
}

const durationOf = (from: Date, to: Date | null, now: Date) => Math.max(0, (to ?? now).getTime() - from.getTime());

/** The rows a run shows now: one per stop, rerun and handed-back ones aside. */
const currentRows = (run: Pick<RunRecord, "stops">) => run.stops.filter((row) => !row.superseded);

// The grid

export interface GridCell {
  runId: string;
  state: StopViewState;
  /** How long the stop took, or has taken so far; null before the run reached it. */
  durationMs: number | null;
  /** Attempts in this run, retries and reruns included. */
  attempts: number;
}

export interface RunGrid {
  /** Stops in the order a run meets them; stops only older versions had come last. */
  stops: { id: string; name: string }[];
  /** Newest first. */
  runs: { id: string; number: number; name: string | null; status: RunStatus }[];
  /** By stop id, one cell per run, in the order of `runs`. */
  cells: Record<string, GridCell[]>;
}

/** One row per stop and one column per run (newest left), each cell the stop's state in that run. */
export function runGrid(definition: PipelineDefinition, runs: readonly RunRecord[], now: Date): RunGrid {
  const newest = [...runs].sort((a, b) => b.number - a.number);
  const names = new Map(definition.stops.map((stop) => [stop.id, stop.name]));
  const ids = [...stopOrder(definition)];
  for (const run of newest) for (const row of run.stops) if (!ids.includes(row.stopId)) ids.push(row.stopId);
  const cells: Record<string, GridCell[]> = {};
  for (const id of ids) {
    cells[id] = newest.map((run) => {
      const rows = run.stops.filter((row) => row.stopId === id);
      const current = rows.find((row) => !row.superseded);
      const reached = current && current.state !== "skipped" && current.state !== "not_reached";
      return {
        runId: run.id,
        state: current ? stopViewState(current.state, current.taskStatus) : "upcoming",
        durationMs: reached ? durationOf(current.startedAt, current.endedAt, now) : null,
        attempts: rows.reduce((sum, row) => sum + (row.state === "skipped" || row.state === "not_reached" ? 0 : row.superseded ? 1 : row.attempt), 0),
      };
    });
  }
  return {
    stops: ids.map((id) => ({ id, name: names.get(id) ?? id })),
    runs: newest.map(({ id, number, name, status }) => ({ id, number, name: name ?? null, status })),
    cells,
  };
}

// Insights

export interface StopTimes {
  id: string;
  name: string;
  /** Finished, timed runs of this stop. */
  count: number;
  p50: number | null;
  p90: number | null;
}

export interface PersonWait {
  id: string;
  name: string;
  /** Typical and slow waits for a decision, counting decisions still open. */
  p50: number | null;
  p90: number | null;
  /** Decisions open there now. */
  waiting: number;
}

export interface FlakyStop {
  id: string;
  name: string;
  /** Runs where it failed and then passed on a retry or rerun. */
  flaky: number;
  /** Runs that reached it. */
  reached: number;
}

export interface Insights {
  /** Runs that finished, and of those how many reached an end (done); cancelled runs aside. */
  finished: number;
  succeeded: number;
  successRate: number | null;
  tripP50: number | null;
  tripP90: number | null;
  stops: StopTimes[];
  waits: PersonWait[];
  flaky: FlakyStop[];
  /** Each finished run oldest first, its trip time as a share of the slowest: the trend. */
  trend: { id: string; number: number; status: RunStatus; durationMs: number; share: number }[];
}

export function pipelineInsights(definition: PipelineDefinition, runs: readonly RunRecord[], now: Date): Insights {
  const finished = runs.filter((run) => run.status === "done" || run.status === "failed");
  const succeeded = finished.filter((run) => run.status === "done");
  const trips = succeeded.filter((run) => run.endedAt).map((run) => durationOf(run.startedAt, run.endedAt, now));
  const order = stopOrder(definition);
  const byId = new Map(definition.stops.map((stop) => [stop.id, stop]));

  const stops: StopTimes[] = order.map((id) => {
    const times = runs.flatMap((run) => currentRows(run).filter((row) => row.stopId === id && row.state === "done" && row.endedAt).map((row) => durationOf(row.startedAt, row.endedAt, now)));
    return { id, name: byId.get(id)!.name, count: times.length, p50: percentile(times, 0.5), p90: percentile(times, 0.9) };
  });

  const waits: PersonWait[] = order
    .filter((id) => byId.get(id)!.kind === "person" && byId.get(id)!.blocking)
    .map((id) => {
      const rows = runs.flatMap((run) => currentRows(run).filter((row) => row.stopId === id && (row.state === "done" || row.state === "waiting")));
      const times = rows.map((row) => durationOf(row.startedAt, row.state === "waiting" ? null : row.endedAt, now));
      return { id, name: byId.get(id)!.name, p50: percentile(times, 0.5), p90: percentile(times, 0.9), waiting: rows.filter((row) => row.state === "waiting").length };
    })
    .sort((a, b) => (b.p50 ?? -1) - (a.p50 ?? -1));

  const flaky: FlakyStop[] = order
    .map((id) => {
      let reached = 0;
      let flakyRuns = 0;
      for (const run of runs) {
        const rows = run.stops.filter((row) => row.stopId === id && row.state !== "skipped" && row.state !== "not_reached");
        if (rows.length === 0) continue;
        reached++;
        const current = rows.find((row) => !row.superseded);
        const failedBefore = rows.some((row) => row.superseded && row.state === "failed") || (current !== undefined && current.attempt > 1);
        if (current?.state === "done" && failedBefore) flakyRuns++;
      }
      return { id, name: byId.get(id)!.name, flaky: flakyRuns, reached };
    })
    .filter((stop) => stop.flaky > 0)
    .sort((a, b) => b.flaky / b.reached - a.flaky / a.reached);

  const timed = [...finished].filter((run) => run.endedAt).sort((a, b) => a.number - b.number);
  const slowest = Math.max(1, ...timed.map((run) => durationOf(run.startedAt, run.endedAt, now)));
  return {
    finished: finished.length,
    succeeded: succeeded.length,
    successRate: finished.length ? succeeded.length / finished.length : null,
    tripP50: percentile(trips, 0.5),
    tripP90: percentile(trips, 0.9),
    stops,
    waits,
    flaky,
    trend: timed.map((run) => {
      const durationMs = durationOf(run.startedAt, run.endedAt, now);
      return { id: run.id, number: run.number, status: run.status, durationMs, share: durationMs / slowest };
    }),
  };
}

// One run's timeline

export interface RunTrack {
  stopId: string;
  /** Where its bar starts and ends, as shares of the run's span. */
  from: number;
  to: number;
  /** Still going: the bar runs to now. */
  open: boolean;
}

/**
 * One track per stop the run reached, on an axis from the run's start to its end (or now): the
 * stop's bar from when it was reached to when it settled. Stops never reached have no track.
 */
export function runTracks(
  run: { startedAt: Date; endedAt: Date | null },
  stops: readonly { stopId: string; state: StopState | "upcoming"; startedAt: Date | null; endedAt: Date | null }[],
  now: Date,
): { tracks: RunTrack[]; spanMs: number } {
  const start = run.startedAt.getTime();
  const end = Math.max(start + 1, (run.endedAt ?? now).getTime(), ...stops.map((stop) => (stop.endedAt ?? (stop.startedAt ? now : run.startedAt)).getTime()));
  const span = end - start;
  const share = (at: number) => Math.min(1, Math.max(0, (at - start) / span));
  const tracks = stops
    .filter((stop) => stop.startedAt && stop.state !== "upcoming" && stop.state !== "skipped" && stop.state !== "not_reached")
    .map((stop) => {
      const open = !stop.endedAt;
      return { stopId: stop.stopId, from: share(stop.startedAt!.getTime()), to: share((stop.endedAt ?? (run.endedAt && !open ? run.endedAt : now)).getTime()), open };
    });
  return { tracks, spanMs: span };
}

// Schedules

const MINUTE = 60_000;

/**
 * The next time a schedule fires after `after`, to the minute, within `withinDays`; null when it
 * does not (or cannot be read). Schedules fire at most hourly, at one minute past the hour, so it
 * finds that minute in the zone and then steps an hour at a time.
 */
export function nextFiring(expression: string, timeZone: string, after: Date, withinDays = 400): Date | null {
  const parsed = parseCron(expression);
  if ("error" in parsed) return null;
  const minutes = parsed.spec.fields[0];
  let at = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE;
  const limit = after.getTime() + withinDays * 24 * 60 * MINUTE;
  let guard = 0;
  while (at <= limit && guard++ < 20_000) {
    if (!minutes.has(zonedFields(new Date(at), timeZone)[0])) {
      at += MINUTE;
      continue;
    }
    if (cronMatches(parsed.spec, new Date(at), timeZone)) return new Date(at);
    at += 60 * MINUTE;
  }
  return null;
}

// Versions

const describeThen = (stop: PipelineStop): string => {
  const { then } = stop;
  if (then.next) return `then ${then.next}`;
  if (then.fork) return `forks to ${then.fork.join(", ")}`;
  if (then.choice) return `chooses ${then.choice.map((branch) => `${branch.label} → ${branch.to ?? `end ${branch.end}`}`).join("; ")}`;
  return `ends at ${then.end}`;
};

const who = (stop: PipelineStop): string =>
  stop.kind === "agent" ? `agent ${stop.agent}` : stop.kind === "person" ? (stop.person ? `person ${stop.person}` : `anyone who is ${stop.role}`) : stop.kind === "any_agent" ? "any agent" : "another pipeline";

/** What changed from one definition to the next, a line each, in the order a reader checks them. */
export function definitionDiff(before: PipelineDefinition, after: PipelineDefinition): string[] {
  const changes: string[] = [];
  const old = new Map(before.stops.map((stop) => [stop.id, stop]));
  const now = new Map(after.stops.map((stop) => [stop.id, stop]));
  if (before.start !== after.start) changes.push(`Starts at "${after.start}" instead of "${before.start}".`);
  for (const stop of after.stops) {
    const was = old.get(stop.id);
    if (!was) {
      changes.push(`Added the stop "${stop.name}" (${who(stop)}, ${describeThen(stop)}).`);
      continue;
    }
    const label = `"${stop.name}"`;
    if (was.name !== stop.name) changes.push(`Renamed "${was.name}" to ${label}.`);
    if (who(was) !== who(stop)) changes.push(`${label} is served by ${who(stop)} instead of ${who(was)}.`);
    if (describeThen(was) !== describeThen(stop)) changes.push(`${label} ${describeThen(stop)} (was: ${describeThen(was)}).`);
    if (was.instructions !== stop.instructions) changes.push(`${label} has new instructions.`);
    if ((was.timeLimitMinutes ?? null) !== (stop.timeLimitMinutes ?? null)) {
      changes.push(`${label} ${stop.timeLimitMinutes ? `has a time limit of ${stop.timeLimitMinutes} minutes` : "has no time limit"} (was ${was.timeLimitMinutes ? `${was.timeLimitMinutes} minutes` : "none"}).`);
    }
    if (was.onFailure.action !== stop.onFailure.action || was.onFailure.times !== stop.onFailure.times) changes.push(`${label} on failure: ${stop.onFailure.action} (was ${was.onFailure.action}).`);
    if (was.options.join("|") !== stop.options.join("|")) changes.push(`${label} offers ${stop.options.map((option) => `"${option}"`).join(", ") || "no options"}.`);
    if ((was.join ?? "all") !== (stop.join ?? "all")) changes.push(`${label} joins on ${stop.join ?? "all"} (was ${was.join ?? "all"}).`);
    if (was.blocking !== stop.blocking) changes.push(`${label} is ${stop.blocking ? "blocking" : "advisory"} now.`);
    if (was.onTimeout !== stop.onTimeout) changes.push(`${label} times out to ${stop.onTimeout ? `"${stop.onTimeout}"` : "nothing"}.`);
    if (was.outputs.join("|") !== stop.outputs.join("|")) changes.push(`${label} hands on ${stop.outputs.join("; ") || "nothing in particular"}.`);
    if (was.approvals !== stop.approvals) changes.push(`${label} needs ${stop.approvals} approvals (was ${was.approvals}).`);
  }
  for (const stop of before.stops) if (!now.has(stop.id)) changes.push(`Removed the stop "${stop.name}".`);
  const oldEnds = new Map(before.ends.map((end) => [end.id, end.name]));
  const newEnds = new Map(after.ends.map((end) => [end.id, end.name]));
  for (const [id, name] of newEnds) {
    if (!oldEnds.has(id)) changes.push(`Added the end "${name}".`);
    else if (oldEnds.get(id) !== name) changes.push(`Renamed the end "${oldEnds.get(id)}" to "${name}".`);
  }
  for (const [id, name] of oldEnds) if (!newEnds.has(id)) changes.push(`Removed the end "${name}".`);
  const oldInputs = new Set(before.inputs.map((input) => input.name));
  const newInputs = new Set(after.inputs.map((input) => input.name));
  for (const name of newInputs) if (!oldInputs.has(name)) changes.push(`Added the input "${name}".`);
  for (const name of oldInputs) if (!newInputs.has(name)) changes.push(`Removed the input "${name}".`);
  return changes;
}

// Person stops

export type StepTarget = { kind: "stop"; stop: PipelineStop } | { kind: "end"; name: string } | { kind: "fork"; stops: PipelineStop[] };

/** Where the run goes after a stop when a person picks `option` (or, with no choice, whatever they pick). */
export function nextStepFor(definition: PipelineDefinition, stopId: string, option: string): StepTarget | null {
  const stop = definition.stops.find((candidate) => candidate.id === stopId);
  if (!stop) return null;
  const stopNamed = (id: string) => definition.stops.find((candidate) => candidate.id === id);
  const endNamed = (id: string) => definition.ends.find((end) => end.id === id)?.name ?? id;
  const { then } = stop;
  if (then.next) {
    const next = stopNamed(then.next);
    return next ? { kind: "stop", stop: next } : null;
  }
  if (then.fork) return { kind: "fork", stops: then.fork.map(stopNamed).filter((found): found is PipelineStop => Boolean(found)) };
  if (then.end) return { kind: "end", name: endNamed(then.end) };
  const branch = then.choice?.find((candidate) => candidate.label.trim().toLowerCase() === option.trim().toLowerCase());
  if (!branch) return null;
  if (branch.end) return { kind: "end", name: endNamed(branch.end) };
  const next = stopNamed(branch.to!);
  return next ? { kind: "stop", stop: next } : null;
}

/** "Stop 3 of 5": where a stop comes in the order a run meets them. */
export function stopPosition(definition: PipelineDefinition, stopId: string): { index: number; total: number } | null {
  const order = stopOrder(definition);
  const index = order.indexOf(stopId);
  return index < 0 ? null : { index: index + 1, total: order.length };
}

/**
 * The stop a run page opens on: the first waiting on a person, else the first that failed, else the
 * first at work, else the last one that settled.
 */
export function focusStopOf(stops: readonly { stopId: string; state: StopState | "upcoming" }[]): string | null {
  for (const state of ["waiting", "failed", "active"] as const) {
    const found = stops.find((stop) => stop.state === state);
    if (found) return found.stopId;
  }
  return [...stops].reverse().find((stop) => stop.state !== "upcoming")?.stopId ?? stops[0]?.stopId ?? null;
}
