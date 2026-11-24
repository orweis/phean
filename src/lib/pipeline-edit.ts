/**
 * The structured editor's moves on a definition, pure so they are tested and the editor only
 * renders: add a stop after another, fork or branch with a choice at a stop, remove and reorder
 * stops, and add or remove ends. Each returns a new definition; `definitionProblems` judges it.
 */
import { PIPELINE_LIMITS, targetsOf, type PipelineDefinition, type PipelineStop, type StopThen } from "./pipelines";

/** A fresh id with this prefix that no stop, end or input has. */
export function freshId(definition: PipelineDefinition, prefix: string): string {
  const used = new Set([...definition.stops.map((stop) => stop.id), ...definition.ends.map((end) => end.id)]);
  if (!used.has(prefix)) return prefix;
  for (let n = 2; ; n++) if (!used.has(`${prefix}_${n}`)) return `${prefix}_${n}`;
}

export function blankStop(id: string, name: string, then: StopThen): PipelineStop {
  return { id, name, kind: "any_agent", approvals: 1, options: [], blocking: true, instructions: "", outputs: [], onFailure: { action: "fail", times: 1 }, then };
}

const replaceStop = (definition: PipelineDefinition, stop: PipelineStop): PipelineDefinition => ({
  ...definition,
  stops: definition.stops.map((candidate) => (candidate.id === stop.id ? stop : candidate)),
});

function insertAfter(definition: PipelineDefinition, afterId: string, added: PipelineStop[]): PipelineStop[] {
  const index = definition.stops.findIndex((stop) => stop.id === afterId);
  const stops = [...definition.stops];
  stops.splice(index + 1, 0, ...added);
  return stops;
}

/** A new stop right after `stopId`: it takes over what came after, and the stop leads to it. */
export function addStopAfter(definition: PipelineDefinition, stopId: string): PipelineDefinition {
  const stop = definition.stops.find((candidate) => candidate.id === stopId);
  if (!stop || definition.stops.length >= PIPELINE_LIMITS.stops) return definition;
  const id = freshId(definition, "stop");
  const added = blankStop(id, "New stop", stop.then);
  return { ...definition, stops: insertAfter(replaceStop(definition, { ...stop, then: { next: id } }), stopId, [added]) };
}

/**
 * Forks at a stop: two new stops run side by side after it, each going where the stop went. When
 * that was another stop, it becomes a join (waiting for both).
 */
export function forkAt(definition: PipelineDefinition, stopId: string): PipelineDefinition {
  const stop = definition.stops.find((candidate) => candidate.id === stopId);
  if (!stop || definition.stops.length + 2 > PIPELINE_LIMITS.stops) return definition;
  const first = freshId(definition, "branch");
  const second = freshId({ ...definition, stops: [...definition.stops, blankStop(first, "", {})] }, "branch");
  const onward: StopThen = stop.then.next ? { next: stop.then.next } : stop.then.end ? { end: stop.then.end } : { end: definition.ends[0]?.id };
  const added = [blankStop(first, "Branch A", onward), blankStop(second, "Branch B", onward)];
  return { ...definition, stops: insertAfter(replaceStop(definition, { ...stop, then: { fork: [first, second] } }), stopId, added) };
}

/**
 * Branches with a choice at a stop: its result (or a person's answer) picks "Yes", a new stop that
 * goes where the stop went, or "No", which ends the run at the first end. A person stop offers the
 * labels as its options.
 */
export function choiceAt(definition: PipelineDefinition, stopId: string): PipelineDefinition {
  const stop = definition.stops.find((candidate) => candidate.id === stopId);
  if (!stop || definition.stops.length >= PIPELINE_LIMITS.stops || definition.ends.length === 0) return definition;
  const id = freshId(definition, "stop");
  const onward: StopThen = stop.then.next ? { next: stop.then.next } : stop.then.end ? { end: stop.then.end } : { end: definition.ends[0]!.id };
  const then: StopThen = { choice: [{ label: "Yes", to: id }, { label: "No", end: definition.ends.at(-1)!.id }] };
  const changed = { ...stop, then, ...(stop.kind === "person" && { options: ["Yes", "No"] }) };
  return { ...definition, stops: insertAfter(replaceStop(definition, changed), stopId, [blankStop(id, "New stop", onward)]) };
}

/**
 * Removes a stop: whatever led to it now goes where it went (a single next), or, when it branched,
 * to the first end. Choices drop branches to it only when that leaves two or more.
 */
export function removeStop(definition: PipelineDefinition, stopId: string): PipelineDefinition {
  const stop = definition.stops.find((candidate) => candidate.id === stopId);
  if (!stop || definition.stops.length <= 1) return definition;
  const onward: StopThen = stop.then.next ? { next: stop.then.next } : stop.then.end ? { end: stop.then.end } : { end: definition.ends[0]?.id };
  const stops = definition.stops
    .filter((candidate) => candidate.id !== stopId)
    .map((candidate): PipelineStop => {
      const { then } = candidate;
      if (then.next === stopId) return { ...candidate, then: onward };
      if (then.fork?.includes(stopId)) {
        const fork = then.fork.filter((id) => id !== stopId);
        return { ...candidate, then: fork.length >= 2 ? { fork } : fork.length === 1 ? { next: fork[0] } : onward };
      }
      if (then.choice?.some((branch) => branch.to === stopId)) {
        return { ...candidate, then: { ...then, choice: then.choice.map((branch) => (branch.to === stopId ? { label: branch.label, ...(onward.next ? { to: onward.next } : { end: onward.end }) } : branch)) } };
      }
      return candidate;
    });
  return { ...definition, start: definition.start === stopId ? (stop.then.next ?? stops[0]!.id) : definition.start, stops };
}

/** Moves a stop up or down the list; the list's order is only how the editor shows it. */
export function moveStop(definition: PipelineDefinition, stopId: string, by: -1 | 1): PipelineDefinition {
  const index = definition.stops.findIndex((stop) => stop.id === stopId);
  const to = index + by;
  if (index < 0 || to < 0 || to >= definition.stops.length) return definition;
  const stops = [...definition.stops];
  [stops[index], stops[to]] = [stops[to]!, stops[index]!];
  return { ...definition, stops };
}

/** Renames a stop's id everywhere it is named (its edges, the start); templates are left to the person. */
export function renameStopId(definition: PipelineDefinition, from: string, to: string): PipelineDefinition {
  const swap = (id: string | undefined) => (id === from ? to : id);
  return {
    ...definition,
    start: swap(definition.start)!,
    stops: definition.stops.map((stop) => ({
      ...stop,
      id: swap(stop.id)!,
      then: {
        ...stop.then,
        ...(stop.then.next !== undefined && { next: swap(stop.then.next) }),
        ...(stop.then.fork && { fork: stop.then.fork.map((id) => swap(id)!) }),
        ...(stop.then.choice && { choice: stop.then.choice.map((branch) => ({ ...branch, ...(branch.to && { to: swap(branch.to) }) })) }),
      },
    })),
  };
}

/** Stops with two or more stops leading to them: where a join mode applies. */
export function joinsOf(definition: PipelineDefinition): Set<string> {
  const count = new Map<string, number>();
  for (const stop of definition.stops) for (const id of new Set(targetsOf(stop).stops)) count.set(id, (count.get(id) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([id]) => id));
}

/** Drops a join mode from stops that are no longer joins, which the checks would refuse. */
export function tidyJoins(definition: PipelineDefinition): PipelineDefinition {
  const joins = joinsOf(definition);
  return { ...definition, stops: definition.stops.map((stop) => (stop.join && !joins.has(stop.id) ? { ...stop, join: undefined } : stop)) };
}
