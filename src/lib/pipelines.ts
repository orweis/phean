/**
 * Pipelines, the pure part: a definition's shape, the checks that keep it a well-formed line, the
 * planner that works out where a run goes next, the handoff-note templates, and the cron matcher for
 * schedules. Client-safe, so the editor and the map (phase 2) read the same rules the engine
 * (`server/domain/pipeline-engine.ts`) runs.
 *
 * A definition is a small graph. Stops are served by an agent, a person or any agent; each says what
 * comes after it (`then`): the `next` stop, a `fork` (every branch runs), a `choice` (one branch,
 * chosen by the stop's result or the person's answer), or an `end`. A stop where branches meet is a
 * join and waits for `all` of them, or goes on with the `first`. There are no loops: repeating work is
 * a stop's failure rule (`retry`, `hand_back`), never an edge.
 */
import {
  LIVE_STOP_STATES,
  type ApproverRole,
  type FailureAction,
  type JoinMode,
  type StopKind,
  type StopState,
} from "./domain";

/** Ids of stops, ends and inputs: short, lowercase, safe in a template (`{{stops.draft.result}}`). */
export const PIPELINE_ID_PATTERN = "[a-z][a-z0-9_]{0,39}";
const PIPELINE_ID = new RegExp(`^${PIPELINE_ID_PATTERN}$`);

export const PIPELINE_LIMITS = {
  stops: 40,
  ends: 12,
  inputs: 20,
  outputs: 10,
  branches: 8,
  /** Retries or hand-backs one failure rule allows. */
  times: 5,
  approvals: 5,
  /** The longest a stop may take: 30 days. */
  timeLimitMinutes: 60 * 24 * 30,
  instructions: 4000,
} as const;

/** A value a run is started with, named in templates as `{{input.<name>}}`. */
export interface PipelineInputSpec {
  name: string;
  description: string;
  required: boolean;
}

/** One branch of a choice: the result or answer that picks it (`label`), and where it goes. */
export interface ChoiceBranch {
  label: string;
  /** The stop it leads to; or */
  to?: string;
  /** the end it reaches. */
  end?: string;
}

/** What comes after a stop: exactly one of `next`, `fork`, `choice` or `end`. */
export interface StopThen {
  next?: string;
  fork?: string[];
  choice?: ChoiceBranch[];
  /** The label a choice takes when the result or answer names none of them. */
  default?: string;
  end?: string;
}

/**
 * When a stop fails (its task is dropped, the agent cannot be reached, or its time runs out):
 * `retry` hands it again (up to `times`), `hand_back` hands the stop before it again with the reason
 * (up to `times`), `ask` asks a person (the pipeline's owner unless `person` or `role` names one)
 * whether to retry, and `fail` stops this branch.
 */
export interface FailureRule {
  action: FailureAction;
  times: number;
  person?: string;
  role?: ApproverRole;
}

export interface PipelineStop {
  id: string;
  name: string;
  kind: StopKind;
  /** Agent stops: the agent or sub-agent, by name or id. */
  agent?: string;
  /** Person stops: who decides, by email or user id; or */
  person?: string;
  /** anyone with this role. */
  role?: ApproverRole;
  /** Person stops: how many people must agree on one option (a role only). */
  approvals: number;
  /** Person stops: the decision's options. A choice after the stop fills them from its labels. */
  options: string[];
  /** Person stops: false makes it advisory (FYI): the person is told, and the run goes on. */
  blocking: boolean;
  /** The handoff note, a template: `{{input.topic}}`, `{{stops.draft.result}}`, `{{run.number}}`. */
  instructions: string;
  /** What the stop should hand on: "a draft document", "the PR link". */
  outputs: string[];
  timeLimitMinutes?: number;
  /** Blocking person stops: the option taken when the time limit passes without an answer. */
  onTimeout?: string;
  onFailure: FailureRule;
  /** Where branches meet: wait for all of them (the default) or go on with the first. */
  join?: JoinMode;
  then: StopThen;
}

export interface PipelineEnd {
  id: string;
  name: string;
}

export interface PipelineDefinition {
  /** The first stop. */
  start: string;
  inputs: PipelineInputSpec[];
  stops: PipelineStop[];
  ends: PipelineEnd[];
}

/** Every stop and end a stop can lead to. */
export function targetsOf(stop: Pick<PipelineStop, "then">): { stops: string[]; ends: string[] } {
  const { then } = stop;
  if (then.next) return { stops: [then.next], ends: [] };
  if (then.fork) return { stops: [...then.fork], ends: [] };
  if (then.choice) {
    return {
      stops: then.choice.flatMap((branch) => (branch.to ? [branch.to] : [])),
      ends: then.choice.flatMap((branch) => (branch.end ? [branch.end] : [])),
    };
  }
  return { stops: [], ends: then.end ? [then.end] : [] };
}

/** Each stop's predecessors, in definition order. */
export function predecessorsOf(definition: Pick<PipelineDefinition, "stops">): Map<string, string[]> {
  const preds = new Map<string, string[]>(definition.stops.map((stop) => [stop.id, []]));
  for (const stop of definition.stops) {
    for (const target of new Set(targetsOf(stop).stops)) preds.get(target)?.push(stop.id);
  }
  return preds;
}

function stopMap(definition: Pick<PipelineDefinition, "stops">): Map<string, PipelineStop> {
  return new Map(definition.stops.map((stop) => [stop.id, stop]));
}

/** A stop and every stop after it, on any branch. */
export function descendantsOf(definition: Pick<PipelineDefinition, "stops">, stopId: string): Set<string> {
  const stops = stopMap(definition);
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !stops.has(id)) return;
    seen.add(id);
    for (const next of targetsOf(stops.get(id)!).stops) visit(next);
  };
  visit(stopId);
  return seen;
}

/** Every stop before `stopId` on some path to it (not the stop itself). */
export function ancestorsOf(definition: Pick<PipelineDefinition, "stops">, stopId: string): Set<string> {
  const preds = predecessorsOf(definition);
  const seen = new Set<string>();
  const visit = (id: string) => {
    for (const pred of preds.get(id) ?? []) {
      if (seen.has(pred)) continue;
      seen.add(pred);
      visit(pred);
    }
  };
  visit(stopId);
  return seen;
}

/** Whether some path from `from` reaches an end without passing through `avoid`. */
function reachesEndAvoiding(definition: Pick<PipelineDefinition, "stops">, from: string, avoid: string): boolean {
  const stops = stopMap(definition);
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === avoid || seen.has(id)) return false;
    seen.add(id);
    const stop = stops.get(id);
    if (!stop) return false;
    const targets = targetsOf(stop);
    return targets.ends.length > 0 || targets.stops.some(visit);
  };
  return visit(from);
}

/** The stops in the order a run meets them (a topological order from the start; unreachable ones last). */
export function stopOrder(definition: PipelineDefinition): string[] {
  const preds = predecessorsOf(definition);
  const stops = stopMap(definition);
  const order: string[] = [];
  const placed = new Set<string>();
  const ready = [definition.start];
  while (ready.length) {
    const id = ready.shift()!;
    if (placed.has(id) || !stops.has(id)) continue;
    placed.add(id);
    order.push(id);
    for (const next of targetsOf(stops.get(id)!).stops) {
      if ((preds.get(next) ?? []).every((pred) => placed.has(pred))) ready.push(next);
    }
  }
  return [...order, ...definition.stops.map((stop) => stop.id).filter((id) => !placed.has(id))];
}

/** The template references a text makes, such as `input.topic` or `stops.draft.result`. */
const TEMPLATE_TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function templateRefs(text: string): string[] {
  return [...text.matchAll(TEMPLATE_TOKEN)].map((match) => match[1]!);
}

/** Whether a stop is followed by a choice, so its result or answer picks a branch. */
export const choosesBranch = (stop: Pick<PipelineStop, "then">) => Boolean(stop.then.choice);

/** A pipeline's shape, as analytics counts it (docs/ANALYTICS.md, `pipeline_create`): never a name or an id. */
export function pipelineShape(definition: Pick<PipelineDefinition, "stops">): { stops_count: number; has_person_stop: boolean; has_fork: boolean; has_choice: boolean } {
  return {
    stops_count: definition.stops.length,
    has_person_stop: definition.stops.some((stop) => stop.kind === "person"),
    has_fork: definition.stops.some((stop) => (stop.then.fork?.length ?? 0) > 0),
    has_choice: definition.stops.some(choosesBranch),
  };
}

/**
 * A definition with its defaults filled in: the start is the first stop unless named, and a person
 * stop followed by a choice offers the choice's labels as its options unless it names its own.
 */
export function normalizeDefinition<D extends Omit<PipelineDefinition, "start"> & { start?: string }>(definition: D): PipelineDefinition {
  return {
    ...definition,
    start: definition.start ?? definition.stops[0]?.id ?? "",
    stops: definition.stops.map((stop) =>
      stop.kind === "person" && stop.then.choice && stop.options.length === 0 ? { ...stop, options: stop.then.choice.map((branch) => branch.label) } : stop,
    ),
  };
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Everything wrong with a definition's shape, each in a sentence an agent can act on; empty when it
 * is a well-formed line. Who serves each stop is checked against the workspace by the service.
 */
export function definitionProblems(definition: PipelineDefinition): string[] {
  const problems: string[] = [];
  const { stops, ends, inputs } = definition;
  if (stops.length === 0) return ["A pipeline needs at least one stop."];
  const stopIds = new Set<string>();
  const endIds = new Set(ends.map((end) => end.id));
  for (const stop of stops) {
    if (stopIds.has(stop.id)) problems.push(`Two stops have the id "${stop.id}"; give each its own.`);
    stopIds.add(stop.id);
    if (endIds.has(stop.id)) problems.push(`"${stop.id}" names both a stop and an end; give them different ids.`);
  }
  if (endIds.size !== ends.length) problems.push("Two ends share an id; give each its own.");
  const inputNames = new Set(inputs.map((input) => input.name));
  if (inputNames.size !== inputs.length) problems.push("Two inputs share a name; give each its own.");
  for (const id of [...stopIds, ...endIds, ...inputNames]) {
    if (!PIPELINE_ID.test(id)) problems.push(`"${id}" is not a valid id: use lowercase letters, digits and underscores, starting with a letter.`);
  }
  if (!stopIds.has(definition.start)) problems.push(`start names "${definition.start}", which is not a stop.`);

  const preds = predecessorsOf(definition);
  const byId = stopMap(definition);
  for (const stop of stops) {
    const where = `Stop "${stop.id}"`;
    const thens = (["next", "fork", "choice", "end"] as const).filter((key) => stop.then[key] !== undefined);
    if (thens.length !== 1) problems.push(`${where} must say what comes after it with exactly one of then.next, then.fork, then.choice or then.end.`);
    const { then } = stop;
    if (then.next !== undefined && !stopIds.has(then.next)) problems.push(`${where} goes next to "${then.next}", which is not a stop.${endIds.has(then.next) ? ` To finish there, use then.end: "${then.next}".` : ""}`);
    if (then.end !== undefined && !endIds.has(then.end)) problems.push(`${where} ends at "${then.end}", which is not one of the pipeline's ends.`);
    if (then.fork) {
      if (new Set(then.fork).size < 2) problems.push(`${where} forks into fewer than two different stops; use then.next for one.`);
      for (const target of then.fork) if (!stopIds.has(target)) problems.push(`${where} forks to "${target}", which is not a stop.`);
    }
    if (then.choice) {
      if (then.choice.length < 2) problems.push(`${where} offers a choice of fewer than two branches.`);
      const labels = then.choice.map((branch) => branch.label.trim().toLowerCase());
      if (new Set(labels).size !== labels.length) problems.push(`${where} gives two branches of its choice the same label.`);
      for (const branch of then.choice) {
        if (Boolean(branch.to) === Boolean(branch.end)) problems.push(`${where}'s branch "${branch.label}" needs exactly one of to (a stop) or end.`);
        if (branch.to && !stopIds.has(branch.to)) problems.push(`${where}'s branch "${branch.label}" goes to "${branch.to}", which is not a stop.`);
        if (branch.end && !endIds.has(branch.end)) problems.push(`${where}'s branch "${branch.label}" ends at "${branch.end}", which is not one of the pipeline's ends.`);
      }
      if (then.default !== undefined && !then.choice.some((branch) => sameLabel(branch.label, then.default!))) {
        problems.push(`${where}'s choice defaults to "${then.default}", which is none of its labels.`);
      }
    } else if (then.default !== undefined) problems.push(`${where} sets then.default without a choice.`);

    // Who serves it.
    if (stop.kind === "pipeline") problems.push(`${where} starts another pipeline: pipeline stops are reserved for factories and not available yet.`);
    if (stop.kind === "agent" && !stop.agent) problems.push(`${where} is an agent stop: name the agent (its name or id) in agent.`);
    if (stop.kind !== "agent" && stop.agent) problems.push(`${where} names an agent but is a ${stop.kind} stop; use kind "agent".`);
    if (stop.kind === "person") {
      if (Boolean(stop.person) === Boolean(stop.role)) problems.push(`${where} is a person stop: name the person (email or user id) in person, or a role (admin or member) in role, not both.`);
      if (stop.person && stop.approvals > 1) problems.push(`${where} names one person, so approvals must be 1; use a role for several approvers.`);
      if (!stop.blocking) {
        if (then.choice) problems.push(`${where} is advisory (blocking: false), so it decides nothing; it cannot be followed by a choice.`);
        if (stop.onTimeout) problems.push(`${where} is advisory (blocking: false), so it has no default outcome to time out to.`);
        if (stop.approvals > 1) problems.push(`${where} is advisory (blocking: false), so it needs no approvals.`);
      }
      if (new Set(stop.options.map((option) => option.trim().toLowerCase())).size !== stop.options.length) problems.push(`${where} offers the same option twice.`);
      if (then.choice) {
        for (const option of stop.options) {
          if (!then.choice.some((branch) => sameLabel(branch.label, option))) problems.push(`${where} offers "${option}", but its choice has no branch with that label.`);
        }
        for (const branch of then.choice) {
          if (!stop.options.some((option) => sameLabel(option, branch.label))) problems.push(`${where}'s choice has a branch "${branch.label}" that is not one of its options.`);
        }
      }
      if (stop.onTimeout !== undefined) {
        if (stop.timeLimitMinutes === undefined) problems.push(`${where} sets onTimeout without timeLimitMinutes.`);
        if (!stop.options.some((option) => sameLabel(option, stop.onTimeout!))) problems.push(`${where} times out to "${stop.onTimeout}", which is not one of its options.`);
      }
    } else {
      if (stop.person || stop.role) problems.push(`${where} names a person or role but is a ${stop.kind} stop; use kind "person".`);
      if (stop.options.length) problems.push(`${where} lists options, which only a person stop offers. An agent's result picks a choice's branch by its label.`);
      if (stop.approvals !== 1) problems.push(`${where} sets approvals, which only a person stop takes.`);
      if (!stop.blocking) problems.push(`${where} sets blocking, which only a person stop takes.`);
      if (stop.onTimeout) problems.push(`${where} sets onTimeout, which only a person stop takes; an agent stop that runs out of time fails (see onFailure).`);
    }

    // Failure rules.
    const rule = stop.onFailure;
    if (rule.action === "hand_back" && (preds.get(stop.id) ?? []).length !== 1) {
      problems.push(`${where} hands back on failure, which needs exactly one stop before it.`);
    }
    if (rule.action !== "ask" && (rule.person || rule.role)) problems.push(`${where}'s failure rule names who to ask, but its action is "${rule.action}".`);
    if (rule.action === "ask" && rule.person && rule.role) problems.push(`${where}'s failure rule asks a person or a role, not both.`);

    // Joins.
    const incoming = preds.get(stop.id) ?? [];
    if (stop.join && incoming.length < 2) problems.push(`${where} sets join, but only one stop leads to it; join is for stops where branches meet.`);
    if (stop.id === definition.start && incoming.length) problems.push(`The start, "${stop.id}", has stops leading back to it, which would make a loop.`);

    // Templates.
    const before = ancestorsOf(definition, stop.id);
    for (const ref of templateRefs(stop.instructions)) {
      const [scope, name, field, ...rest] = ref.split(".");
      const ok =
        (scope === "input" && name !== undefined && inputNames.has(name) && field === undefined) ||
        (scope === "run" && name === "number" && field === undefined) ||
        (scope === "pipeline" && name === "name" && field === undefined) ||
        (scope === "stops" && name !== undefined && before.has(name) && (field === "result" || field === "answer") && rest.length === 0);
      if (ok) continue;
      if (scope === "stops" && name && byId.has(name) && !before.has(name)) problems.push(`${where}'s instructions read {{${ref}}}, but "${name}" does not come before it, so it has no result yet.`);
      else problems.push(`${where}'s instructions read {{${ref}}}, which Phean does not know. Use {{input.<name>}} for a declared input, {{stops.<id>.result}} or {{stops.<id>.answer}} for a stop before it, {{run.number}} or {{pipeline.name}}.`);
    }
  }

  // Loops, then what a run can reach.
  const state = new Map<string, "visiting" | "done">();
  const loop = (id: string, path: string[]): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    for (const next of new Set(targetsOf(byId.get(id)!).stops)) {
      if (!byId.has(next)) continue;
      const found = loop(next, [...path, id]);
      if (found) return found;
    }
    state.set(id, "done");
    return null;
  };
  for (const stop of stops) {
    const cycle = loop(stop.id, []);
    if (cycle) {
      problems.push(`Stops ${cycle.map((id) => `"${id}"`).join(" → ")} form a loop. Pipelines cannot loop: to repeat a stop, give it onFailure retry or hand_back instead.`);
      break;
    }
  }
  if (stopIds.has(definition.start)) {
    const reachable = descendantsOf(definition, definition.start);
    for (const stop of stops) if (!reachable.has(stop.id)) problems.push(`Stop "${stop.id}" is never reached from the start, "${definition.start}". Lead to it from another stop, or remove it.`);
    const reachedEnds = new Set([...reachable].flatMap((id) => targetsOf(byId.get(id)!).ends));
    if (reachedEnds.size === 0) problems.push("No branch reaches an end: finish at least one with then.end.");
    for (const end of ends) if (!reachedEnds.has(end.id)) problems.push(`End "${end.id}" is never reached; lead a branch to it or remove it.`);
  }
  return [...new Set(problems)];
}

/** A stop's progress in a run: its state, and for a stop followed by a choice, the branch it took. */
export interface StopProgress {
  state: StopState;
  branch: string | null;
}

const isLive = (state: StopState | undefined) => state !== undefined && (LIVE_STOP_STATES as readonly StopState[]).includes(state);

/** The branch of a choice a label names, if any. */
export function branchNamed(stop: Pick<PipelineStop, "then">, label: string | null): ChoiceBranch | undefined {
  return label === null ? undefined : stop.then.choice?.find((branch) => sameLabel(branch.label, label));
}

type EdgeState = "pending" | "arrived" | "skipped" | "dead";

function edgeState(from: PipelineStop, to: string, progress: ReadonlyMap<string, StopProgress>): EdgeState {
  const own = progress.get(from.id);
  if (!own || isLive(own.state)) return "pending";
  if (own.state === "done") {
    if (!from.then.choice) return "arrived";
    return branchNamed(from, own.branch)?.to === to ? "arrived" : "skipped";
  }
  if (own.state === "skipped") return "skipped";
  return "dead";
}

/**
 * Where a run goes next, from where each stop stands (stops not in `progress` are upcoming):
 * - `reach`: stops whose inputs have arrived. A stop where branches meet (a join) waits for all its
 *   live branches; with join "first" it goes on as soon as one arrives.
 * - `skip`: stops on a branch a choice did not take, or after one.
 * - `notReach`: stops whose inputs can never arrive: a failure upstream (a join "all" waits on every
 *   branch, so one failed branch stops it), or the losing side of a "first" join.
 * - `cancel`: live stops that lead only to a "first" join that another branch has just reached.
 * Each list is complete: what one decision implies downstream is already in it.
 */
export function planRun(definition: PipelineDefinition, progress: ReadonlyMap<string, StopProgress>): { reach: string[]; skip: string[]; notReach: string[]; cancel: string[] } {
  const preds = predecessorsOf(definition);
  const byId = stopMap(definition);
  const working = new Map(progress);
  const plan = { reach: [] as string[], skip: [] as string[], notReach: [] as string[], cancel: [] as string[] };
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of stopOrder(definition)) {
      if (working.has(id)) continue;
      const stop = byId.get(id)!;
      const incoming = preds.get(id) ?? [];
      if (incoming.length === 0) {
        if (id !== definition.start) continue;
        plan.reach.push(id);
        working.set(id, { state: "active", branch: null });
        changed = true;
        continue;
      }
      const edges = incoming.map((pred) => edgeState(byId.get(pred)!, id, working));
      const count = (state: EdgeState) => edges.filter((edge) => edge === state).length;
      const mode = stop.join ?? "all";
      let decision: "reach" | "skip" | "notReach" | null = null;
      if (mode === "all") {
        if (count("dead")) decision = "notReach";
        else if (count("pending")) decision = null;
        else decision = count("arrived") ? "reach" : "skip";
      } else if (count("arrived")) decision = "reach";
      else if (count("pending")) decision = null;
      else decision = count("dead") ? "notReach" : "skip";
      if (!decision) continue;
      plan[decision].push(id);
      working.set(id, { state: decision === "reach" ? "active" : decision === "skip" ? "skipped" : "not_reached", branch: null });
      changed = true;
      if (decision === "reach" && mode === "first" && count("pending")) {
        // The other branches lost: what is live on them, leading only here, stops.
        for (const ancestor of ancestorsOf(definition, id)) {
          if (!isLive(working.get(ancestor)?.state) || reachesEndAvoiding(definition, ancestor, id)) continue;
          plan.cancel.push(ancestor);
          working.set(ancestor, { state: "cancelled", branch: null });
        }
      }
    }
  }
  return plan;
}

/** The end a settled stop reached, if it reached one. */
export function endReachedBy(stop: PipelineStop, progress: StopProgress | undefined): string | null {
  if (progress?.state !== "done") return null;
  if (stop.then.end) return stop.then.end;
  return branchNamed(stop, progress.branch)?.end ?? null;
}

/**
 * Where a run stands as a whole: `waiting` when any live stop waits on a person, else `running`
 * while any stop is live or can still be reached; once nothing can move, `failed` if a stop failed,
 * else `done`. A failure never shows while another branch is alive.
 */
export function rollUp(definition: PipelineDefinition, progress: ReadonlyMap<string, StopProgress>): "running" | "waiting" | "done" | "failed" {
  const states = [...progress.values()].map((entry) => entry.state);
  if (states.includes("waiting")) return "waiting";
  const plan = planRun(definition, progress);
  if (states.includes("active") || plan.reach.length) return "running";
  return states.includes("failed") ? "failed" : "done";
}

/**
 * The branch a result or answer picks: the label it is (case and surrounding punctuation aside), or
 * the one its first line starts with, the longest such label first ("approved with changes" before
 * "approved"). A label merely mentioned later ("not approved") picks nothing.
 */
export function matchBranch(branches: readonly ChoiceBranch[], text: string): ChoiceBranch | null {
  const clean = (value: string) => value.trim().toLowerCase().replace(/^["'“”‘’*_`\s]+|["'“”‘’*_`.!\s]+$/g, "");
  const firstLine = clean(text.split("\n").find((line) => line.trim()) ?? "");
  const ranked = [...branches].sort((a, b) => b.label.length - a.label.length);
  for (const branch of ranked) if (clean(branch.label) === firstLine) return branch;
  for (const branch of ranked) {
    const label = clean(branch.label);
    if (firstLine.startsWith(label) && !/[\p{L}\p{N}]/u.test(firstLine.charAt(label.length))) return branch;
  }
  return null;
}

/** What a template may read when a stop is reached. */
export interface TemplateScope {
  input: Readonly<Record<string, string>>;
  stops: Readonly<Record<string, { result: string; answer: string }>>;
  run: { number: number };
  pipeline: { name: string };
}

/** Fills a stop's instructions in; a reference with nothing behind it (a skipped stop's result) reads "(none)". */
export function renderTemplate(text: string, scope: TemplateScope): string {
  return text.replace(TEMPLATE_TOKEN, (token, ref: string) => {
    const [kind, name, field] = ref.split(".");
    if (kind === "input" && name) return scope.input[name] || "(none)";
    if (kind === "run" && name === "number") return String(scope.run.number);
    if (kind === "pipeline" && name === "name") return scope.pipeline.name;
    if (kind === "stops" && name && (field === "result" || field === "answer")) return scope.stops[name]?.[field] || "(none)";
    return token;
  });
}

// Schedules: five-field cron (minute hour day-of-month month day-of-week) in a time zone.

const CRON_FIELDS = [
  { name: "minute", min: 0, max: 59, names: [] as string[] },
  { name: "hour", min: 0, max: 23, names: [] as string[] },
  { name: "day of month", min: 1, max: 31, names: [] as string[] },
  { name: "month", min: 1, max: 12, names: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] },
  { name: "day of week", min: 0, max: 7, names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] },
] as const;

/** A parsed schedule: the values each field allows, and whether day-of-month and day-of-week were restricted. */
export interface CronSpec {
  fields: [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  anyDay: boolean;
  anyWeekday: boolean;
}

/** Parses a five-field cron expression, or says what is wrong with it. */
export function parseCron(expression: string): { spec: CronSpec } | { error: string } {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return { error: `"${expression}" needs five fields: minute hour day-of-month month day-of-week, such as "0 9 * * 1" for Mondays at 9:00.` };
  const fields: Set<number>[] = [];
  for (const [index, part] of parts.entries()) {
    const field = CRON_FIELDS[index]!;
    const values = new Set<number>();
    const value = (raw: string) => {
      const named = (field.names as readonly string[]).indexOf(raw.toLowerCase());
      if (named >= 0) return named + (field.name === "month" ? 1 : 0);
      return /^\d+$/.test(raw) ? Number(raw) : NaN;
    };
    for (const item of part.split(",")) {
      const [range, stepText] = item.split("/");
      const step = stepText === undefined ? 1 : Number(stepText);
      const [low, upper] = range === "*" ? [field.min, field.max] : ((range ?? "").split("-").map(value) as [number, number | undefined]);
      const high = upper ?? (stepText === undefined ? low : field.max);
      if (!Number.isInteger(step) || step < 1 || Number.isNaN(low) || Number.isNaN(high) || low < field.min || high > field.max || low > high) {
        return { error: `"${part}" is not a valid ${field.name} (${field.min}-${field.max}).` };
      }
      for (let at = low; at <= high; at += step) values.add(field.name === "day of week" && at === 7 ? 0 : at);
    }
    fields.push(values);
  }
  return { spec: { fields: fields as CronSpec["fields"], anyDay: parts[2] === "*", anyWeekday: parts[4] === "*" } };
}

/** A schedule's problem, if it has one: invalid, or more often than once an hour (a run an hour is the most). */
export function cronProblem(expression: string): string | null {
  const parsed = parseCron(expression);
  if ("error" in parsed) return parsed.error;
  if (parsed.spec.fields[0].size !== 1) return `"${expression}" runs more than once an hour; give the minute as one number, such as "0 9 * * 1".`;
  return null;
}

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock minute, hour, day, month and weekday of an instant in a time zone. */
export function zonedFields(at: Date, timeZone: string): [number, number, number, number, number] {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", minute: "numeric", hour: "numeric", day: "numeric", month: "numeric", weekday: "short" });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  return [Number(parts.minute), Number(parts.hour), Number(parts.day), Number(parts.month), weekday];
}

/** Whether a schedule fires at an instant (to the minute). Day-of-month and day-of-week either match, as in cron, when both are set. */
export function cronMatches(spec: CronSpec, at: Date, timeZone: string): boolean {
  const [minute, hour, day, month, weekday] = zonedFields(at, timeZone);
  const [minutes, hours, days, months, weekdays] = spec.fields;
  if (!minutes.has(minute) || !hours.has(hour) || !months.has(month)) return false;
  if (spec.anyDay && spec.anyWeekday) return true;
  if (spec.anyDay) return weekdays.has(weekday);
  if (spec.anyWeekday) return days.has(day);
  return days.has(day) || weekdays.has(weekday);
}

const MINUTE = 60_000;

/**
 * The latest time a schedule fired after `after` and at or before `now`, to the minute; null when it
 * did not. Looks back at most a day, so a schedule that missed days fires once, not for every miss.
 */
export function latestFiring(expression: string, timeZone: string, after: Date, now: Date): Date | null {
  const parsed = parseCron(expression);
  if ("error" in parsed) return null;
  const floor = Math.max(after.getTime(), now.getTime() - 24 * 60 * MINUTE);
  for (let at = Math.floor(now.getTime() / MINUTE) * MINUTE; at > floor; at -= MINUTE) {
    if (cronMatches(parsed.spec, new Date(at), timeZone)) return new Date(at);
  }
  return null;
}
