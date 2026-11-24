/**
 * The line map's geometry: where each stop and end of a pipeline sits, and the edges between them,
 * drawn from the definition left to right with branches stacked below the main line (the plan's
 * "never crossing" rule, as far as a definition allows). Pure and client-safe, so the pipeline page,
 * the run page and the editor's live preview draw the same map; `components/charts/line-map.tsx`
 * lays it out.
 */
import type { JoinMode, StopState, StopViewState } from "./domain";
import { predecessorsOf, stopOrder, targetsOf, type PipelineDefinition, type PipelineStop } from "./pipelines";

export interface MapStopNode {
  kind: "stop";
  /** The stop's id. */
  id: string;
  col: number;
  row: number;
  stop: PipelineStop;
  /** Set where branches meet: how the join waits. */
  join: JoinMode | null;
}

export interface MapEndNode {
  kind: "end";
  /** The end's id. */
  id: string;
  col: number;
  row: number;
  name: string;
}

export type MapNode = MapStopNode | MapEndNode;

export interface MapEdge {
  from: string;
  /** A stop's id, or an end's. */
  to: string;
  toKind: "stop" | "end";
  kind: "next" | "fork" | "choice";
  /** A choice's label ("approved"), and whether it is the one taken when nothing matches. */
  label?: string;
  isDefault?: boolean;
}

export interface LineMap {
  nodes: MapNode[];
  edges: MapEdge[];
  cols: number;
  rows: number;
}

/** The edges a stop starts, in the order its definition lists them. */
export function edgesOf(stop: PipelineStop): MapEdge[] {
  const { then } = stop;
  if (then.next) return [{ from: stop.id, to: then.next, toKind: "stop", kind: "next" }];
  if (then.fork) return [...new Set(then.fork)].map((to) => ({ from: stop.id, to, toKind: "stop" as const, kind: "fork" as const }));
  if (then.choice) {
    const fallback = then.default?.trim().toLowerCase();
    return then.choice.map((branch) => ({
      from: stop.id,
      to: (branch.to ?? branch.end)!,
      toKind: branch.to ? ("stop" as const) : ("end" as const),
      kind: "choice" as const,
      label: branch.label,
      ...(fallback && branch.label.trim().toLowerCase() === fallback && { isDefault: true }),
    }));
  }
  return then.end ? [{ from: stop.id, to: then.end, toKind: "end", kind: "next" }] : [];
}

/**
 * Lays a definition out. A stop's column is one past the furthest stop that leads to it, so a join
 * sits after all its branches; its row is the row of the stop that led to it first, and each further
 * branch of a fork or choice takes a new row below. A join comes back to the highest row among its
 * branches. Ends sit one column past what reaches them. Rows left empty are closed up.
 */
export function lineMap(definition: PipelineDefinition): LineMap {
  const byId = new Map(definition.stops.map((stop) => [stop.id, stop]));
  const preds = predecessorsOf(definition);
  const col = new Map<string, number>();
  const hint = new Map<string, number>();
  const taken = new Set<string>();
  const row = new Map<string, number>();
  let nextRow = 1;
  const place = (column: number, wanted: number): number => {
    let at = wanted;
    while (taken.has(`${column}:${at}`)) at++;
    taken.add(`${column}:${at}`);
    nextRow = Math.max(nextRow, at + 1);
    return at;
  };

  for (const id of stopOrder(definition)) {
    const stop = byId.get(id);
    if (!stop) continue;
    const incoming = (preds.get(id) ?? []).filter((pred) => col.has(pred));
    const column = incoming.length ? Math.max(...incoming.map((pred) => col.get(pred)! + 1)) : 0;
    col.set(id, column);
    const wanted = hint.get(id) ?? (id === definition.start ? 0 : nextRow);
    const at = place(column, wanted);
    row.set(id, at);
    let first = true;
    for (const target of new Set(targetsOf(stop).stops)) {
      const candidate = first ? at : nextRow++;
      first = false;
      hint.set(target, Math.min(hint.get(target) ?? Infinity, candidate));
    }
  }

  // Ends, in definition order, after what reaches them.
  const endNodes: MapEndNode[] = [];
  for (const end of definition.ends) {
    const sources = definition.stops.filter((stop) => targetsOf(stop).ends.includes(end.id) && col.has(stop.id));
    if (sources.length === 0) continue;
    const column = Math.max(...sources.map((stop) => col.get(stop.id)! + 1));
    const wanted = Math.min(...sources.map((stop) => row.get(stop.id)!));
    endNodes.push({ kind: "end", id: end.id, name: end.name, col: column, row: place(column, wanted) });
  }

  const stopNodes: MapStopNode[] = definition.stops
    .filter((stop) => col.has(stop.id))
    .map((stop) => ({ kind: "stop", id: stop.id, col: col.get(stop.id)!, row: row.get(stop.id)!, stop, join: (preds.get(stop.id) ?? []).length > 1 ? (stop.join ?? "all") : null }));
  const nodes: MapNode[] = [...stopNodes, ...endNodes];
  // Close up rows nothing sits on.
  const used = [...new Set(nodes.map((node) => node.row))].sort((a, b) => a - b);
  for (const node of nodes) node.row = used.indexOf(node.row);
  const edges = definition.stops.filter((stop) => col.has(stop.id)).flatMap(edgesOf);
  return {
    nodes,
    edges,
    cols: nodes.reduce((most, node) => Math.max(most, node.col + 1), 0),
    rows: Math.max(1, used.length),
  };
}

/** A stop's progress in one run, as the map reads it. */
export interface StopRunState {
  state: StopState | "upcoming";
  branch: string | null;
}

export type EdgeRunState = "travelled" | "skipped" | "pending";

/**
 * How an edge reads for one run: `travelled` once the stop it leaves is done and (for a choice)
 * took this branch, `skipped` when the choice took another or the stop itself was skipped, and
 * `pending` otherwise.
 */
export function edgeRunState(edge: MapEdge, from: StopRunState | undefined): EdgeRunState {
  if (!from) return "pending";
  if (from.state === "skipped") return "skipped";
  if (from.state !== "done") return "pending";
  if (edge.kind !== "choice") return "travelled";
  return from.branch !== null && from.branch.trim().toLowerCase() === edge.label?.trim().toLowerCase() ? "travelled" : "skipped";
}

/**
 * A stop's state as people read it: an active stop whose task nobody has picked up yet is
 * `handing_off` (its task still waits to be taken), otherwise its own state.
 */
export function stopViewState(state: StopState | "upcoming", taskStatus: string | null | undefined): StopViewState {
  if (state === "active" && (taskStatus === "todo" || taskStatus === "inbox" || taskStatus === "backlog")) return "handing_off";
  return state;
}
