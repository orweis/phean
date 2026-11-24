import { Flag } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/cx";
import { FAILURE_ACTION_META, STOP_VIEW_META, type StopState, type StopViewState } from "@/lib/domain";
import { formatDuration } from "@/lib/format";
import { edgeRunState, lineMap, type MapEdge, type MapNode } from "@/lib/pipeline-map";
import type { PipelineDefinition, PipelineStop } from "@/lib/pipelines";

import { KIND_ICON, StopDot } from "../pipelines/stop-mark";
import { STOP_STYLE } from "./stations";

/** A column's width and a row's height, in pixels; the dot sits near the top of its cell. */
const W = 176;
const H = 120;
const DOT_Y = 32;
const R = 10;

export interface MapStopState {
  state: StopViewState;
  /** The stop's own state, to tell which branch it took. */
  raw: StopState | "upcoming";
  branch: string | null;
}

interface LineMapProps {
  definition: PipelineDefinition;
  /** Names the map for screen readers ("Weekly newsletter's line"). */
  label: string;
  /** Who serves each stop, in words, by stop id. */
  servedBy?: Record<string, string>;
  /** One run's states, when a run rides the map. */
  states?: Record<string, MapStopState>;
  /** The end the run reached. */
  reachedEnd?: string | null;
  /** Where a pointer on each stop goes (its task), by stop id. */
  hrefOf?: Record<string, string>;
  selected?: string | null;
}

const centre = (node: Pick<MapNode, "col" | "row">) => ({ x: node.col * W + W / 2, y: node.row * H + DOT_Y });

function edgePath(from: MapNode, to: MapNode): { d: string; labelAt: { x: number; y: number } } {
  const a = centre(from);
  const b = centre(to);
  // On the same row the label sits above the line past the stop's own cell, clear of its selection ring.
  if (a.y === b.y) return { d: `M ${a.x} ${a.y} H ${b.x}`, labelAt: { x: a.x + W / 2 - 4, y: a.y - 22 } };
  // Down to a branch: turn just after the stop. Up to a join: turn just before it.
  const down = b.y > a.y;
  const x = down ? a.x + W / 2 : b.x - W / 2;
  const s = down ? 1 : -1;
  return {
    d: `M ${a.x} ${a.y} H ${x - R} Q ${x} ${a.y} ${x} ${a.y + s * R} V ${b.y - s * R} Q ${x} ${b.y} ${x + R} ${b.y} H ${b.x}`,
    // Beside the turn, half way down (or up), clear of both stations.
    labelAt: { x: x + 8, y: (a.y + b.y) / 2 - 8 },
  };
}

function thenInWords(stop: PipelineStop, definition: PipelineDefinition): string {
  const name = (id: string) => definition.stops.find((candidate) => candidate.id === id)?.name ?? id;
  const end = (id: string) => definition.ends.find((candidate) => candidate.id === id)?.name ?? id;
  const { then } = stop;
  if (then.next) return `Then ${name(then.next)}.`;
  if (then.fork) return `Then, side by side: ${then.fork.map(name).join(" and ")}.`;
  if (then.choice) return `Then one of: ${then.choice.map((branch) => `“${branch.label}” ${branch.to ? `goes to ${name(branch.to)}` : `ends at ${end(branch.end!)}`}`).join("; ")}.`;
  return `Ends at ${then.end ? end(then.end) : "the end"}.`;
}

/** The stop's rules in a line: its time limit and what happens when it fails. */
export function stopRules(stop: PipelineStop): string {
  const parts = [];
  if (stop.timeLimitMinutes) parts.push(`Time limit ${formatDuration(stop.timeLimitMinutes * 60_000)}${stop.onTimeout ? `, then “${stop.onTimeout}”` : ""}.`);
  if (stop.kind !== "person") parts.push(`On failure: ${FAILURE_ACTION_META[stop.onFailure.action].label.toLowerCase()}${stop.onFailure.action === "retry" || stop.onFailure.action === "hand_back" ? ` (up to ${stop.onFailure.times}×)` : ""}.`);
  if (stop.kind === "person" && !stop.blocking) parts.push("Advisory: the run goes on.");
  return parts.join(" ");
}

function edgeStyle(edge: MapEdge, states: LineMapProps["states"]): { stroke: string; dash?: string; width: number; state: string } {
  if (!states) return { stroke: "stroke-edge", width: 2, state: "plan" };
  const from = states[edge.from];
  const state = edgeRunState(edge, from ? { state: from.raw, branch: from.branch } : undefined);
  if (state === "travelled") return { ...STOP_STYLE.done, dash: undefined, state };
  if (state === "skipped") return { ...STOP_STYLE.skipped, state };
  return { stroke: "stroke-edge", width: 2, state };
}

/**
 * A pipeline drawn as a line on the transit map, left to right: stops are stations (served by an
 * agent or a person), forks and choices branch below, joins come back up at an interchange, and ends
 * are termini. With a run's states, each station shows that run's state by icon, word and line form.
 * The drawing is decorative; the list beside it says the same in words.
 */
export function LineMap({ definition, label, servedBy = {}, states, reachedEnd, hrefOf, selected }: LineMapProps) {
  const map = lineMap(definition);
  const nodes = new Map(map.nodes.map((node) => [`${node.kind}:${node.id}`, node]));
  const width = Math.max(1, map.cols) * W;
  const height = map.rows * H;

  return (
    <div role="region" aria-label={label} tabIndex={0} className="relative overflow-x-auto rounded-md outline-none focus-visible:outline-2 focus-visible:outline-focus">
      <ol className="sr-only">
        {map.nodes
          .filter((node) => node.kind === "stop")
          .map((node, index) => {
            const stop = (node as Extract<MapNode, { kind: "stop" }>).stop;
            return (
              <li key={node.id}>
                {index + 1}. {stop.name}, {servedBy[stop.id] ?? stop.kind.replace("_", " ")}.{states?.[stop.id] && ` ${STOP_VIEW_META[states[stop.id]!.state].label}.`}
                {node.kind === "stop" && node.join && ` ${node.join === "first" ? "Goes on with the first branch to arrive." : "Waits for every branch."}`} {thenInWords(stop, definition)} {stopRules(stop)}
              </li>
            );
          })}
      </ol>
      {reachedEnd && <p className="sr-only">Reached the end {definition.ends.find((end) => end.id === reachedEnd)?.name ?? reachedEnd}.</p>}
      <div aria-hidden data-line-map className="relative" style={{ width, height }}>
        <svg className="absolute inset-0 overflow-visible" width={width} height={height} fill="none">
          {map.edges.map((edge) => {
            const from = nodes.get(`stop:${edge.from}`);
            const to = nodes.get(`${edge.toKind}:${edge.to}`);
            if (!from || !to) return null;
            const { d } = edgePath(from, to);
            const style = edgeStyle(edge, states);
            return (
              <path
                key={`${edge.from}-${edge.toKind}-${edge.to}-${edge.label ?? ""}`}
                d={d}
                data-edge={style.state}
                className={style.stroke}
                strokeWidth={style.width}
                strokeDasharray={style.dash}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
        {map.edges
          .filter((edge) => edge.label)
          .map((edge) => {
            const from = nodes.get(`stop:${edge.from}`);
            const to = nodes.get(`${edge.toKind}:${edge.to}`);
            if (!from || !to) return null;
            const { labelAt } = edgePath(from, to);
            return (
              <span
                key={`label-${edge.from}-${edge.label}`}
                className="absolute max-w-20 truncate rounded-xs bg-panel px-1 text-2xs font-semibold text-ink-2"
                style={{ left: labelAt.x, top: labelAt.y }}
                title={edge.label}
              >
                {edge.label}
                {edge.isDefault && <span className="font-normal text-muted"> (default)</span>}
              </span>
            );
          })}
        {map.nodes.map((node) => {
          const style = { left: node.col * W, top: node.row * H, width: W, height: H };
          if (node.kind === "end") {
            const reached = reachedEnd === node.id;
            return (
              <div key={`end-${node.id}`} data-end-node={node.id} data-reached={reached || undefined} className="absolute flex flex-col items-center px-3" style={style}>
                <span
                  className={cx(
                    "mt-5 inline-flex size-6 items-center justify-center rounded-sm border-2 [&_svg]:size-3.5",
                    reached ? "border-station-done bg-station-done text-panel" : "border-ink-2 bg-panel text-ink-2",
                  )}
                >
                  <Flag strokeWidth={2.5} />
                </span>
                <span className="mt-1.5 line-clamp-2 text-center text-xs font-semibold text-ink">{node.name}</span>
                <span className="text-2xs text-muted">{reached ? "Reached" : "End"}</span>
              </div>
            );
          }
          const { stop } = node;
          const run = states?.[stop.id];
          const KindIcon = KIND_ICON[stop.kind];
          const href = hrefOf?.[stop.id];
          const isSelected = selected === stop.id;
          const body = (
            <>
              <span className="mt-5 flex items-center justify-center">
                {run ? (
                  <StopDot state={run.state} className={cx(stop.kind === "person" && "ring-2 ring-wait-ink/40 ring-offset-2 ring-offset-panel")} />
                ) : (
                  <span
                    className={cx(
                      "inline-flex size-6 items-center justify-center rounded-full border-2 border-edge bg-panel text-ink-2 [&_svg]:size-3.5",
                      stop.kind === "person" && "ring-2 ring-wait-ink/40 ring-offset-2 ring-offset-panel",
                      node.join && "outline-2 outline-offset-3 outline-edge",
                    )}
                  >
                    <KindIcon strokeWidth={2.25} />
                  </span>
                )}
              </span>
              <span className={cx("mt-1.5 line-clamp-2 rounded-xs px-1 text-center text-xs font-semibold text-ink", isSelected && "bg-accent-tint text-accent-ink")}>{stop.name}</span>
              <span className="flex max-w-full items-center gap-1 truncate text-2xs text-muted">
                <KindIcon className="size-3 shrink-0" />
                <span className="truncate">{servedBy[stop.id] ?? stop.agent ?? stop.kind.replace("_", " ")}</span>
              </span>
              {run && <span className="text-2xs font-semibold text-ink-2">{STOP_VIEW_META[run.state].label}</span>}
              {!run && node.join && <span className="text-2xs text-muted">{node.join === "first" ? "First to arrive" : "Waits for all"}</span>}
            </>
          );
          const title = [stop.name, stop.instructions, stopRules(stop)].filter(Boolean).join("\n\n");
          const className = cx(
            "absolute flex flex-col items-center px-3",
            isSelected && "before:absolute before:inset-x-2 before:top-2 before:bottom-1 before:rounded-md before:border-2 before:border-accent",
          );
          return href ? (
            <Link key={stop.id} href={href} scroll={false} tabIndex={-1} data-stop={stop.id} data-selected={isSelected || undefined} title={title} className={className} style={style}>
              {body}
            </Link>
          ) : (
            <div key={stop.id} data-stop={stop.id} data-selected={isSelected || undefined} title={title} className={className} style={style}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
