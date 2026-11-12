import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { cx } from "@/lib/cx";
import { GOAL_STATUS_META, isLate, type GoalStatus } from "@/lib/domain";
import { routes } from "@/lib/routes";
import type { MapLayout, MapNode } from "@/lib/task-map";
import type { TaskView } from "@/server/domain/tasks";

import { FlowLegend } from "./charts/flow-bar";
import { STATION_MARK } from "./goal-tree";
import { StationDot, TaskPeekLink, WaitingNote } from "./task-marks";

/** The grid the map is drawn on, in pixels: a column per level, a row per leaf. */
const COLUMN = 288;
const ROW = 60;
const NODE_WIDTH = 256;
const NODE_HEIGHT = 48;

const left = (node: MapNode) => node.depth * COLUMN;
const middle = (node: MapNode) => node.row * ROW + ROW / 2;

/**
 * Where a node sits on the canvas, from 640px up; below that the same list is an indented outline.
 * The position travels as custom properties, so a phone's layout can ignore it.
 */
const place = (node: MapNode) => ({ "--x": `${left(node)}px`, "--y": `${middle(node) - NODE_HEIGHT / 2}px`, "--w": `${NODE_WIDTH}px` }) as CSSProperties;
const BOX = "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs leading-4 max-sm:mb-1.5 sm:absolute sm:top-(--y) sm:left-(--x) sm:h-12 sm:w-(--w)";
const SELECTED = "data-selected:border-accent data-selected:bg-accent-tint data-selected:outline-2 data-selected:outline-accent";

/** One node: a goal opens its page, a task opens in the side peek, the loose root is only a label. */
function NodeBox({ node, slug, task, goalStatus }: { node: MapNode; slug: string; task?: TaskView; goalStatus?: GoalStatus }) {
  if (node.kind === "goal") {
    return (
      <Link href={routes.goal(slug, node.id)} style={place(node)} className={cx(BOX, "border-rule bg-panel font-semibold text-ink hover:border-edge")}>
        {goalStatus && <span aria-hidden className={cx("size-3 shrink-0 rounded-full", STATION_MARK[goalStatus])} />}
        <span className="line-clamp-2 min-w-0">{node.title}</span>
        {goalStatus && goalStatus !== "active" && <span className="ml-auto shrink-0 font-normal text-muted">{GOAL_STATUS_META[goalStatus].label}</span>}
      </Link>
    );
  }
  if (node.kind === "loose") {
    return (
      <span style={place(node)} className={cx(BOX, "border-dashed border-edge bg-panel font-semibold text-ink-2")}>
        {node.title}
      </span>
    );
  }
  const late = task ? isLate(task) : false;
  return (
    <TaskPeekLink
      slug={slug}
      taskId={node.id}
      style={place(node)}
      className={cx(BOX, "bg-panel text-ink hover:border-edge", late ? "border-late/60" : "border-rule", node.kind === "subtask" && "text-ink-2", SELECTED)}
    >
      {task && <StationDot status={task.status} />}
      <span className="line-clamp-2 min-w-0">{node.title}</span>
      <span className="ml-auto flex shrink-0 flex-col items-end">
        {task?.inputRequest && <WaitingNote kind={task.inputRequest.kind} />}
        {late && <span className="font-semibold text-late-ink">Late</span>}
      </span>
    </TaskPeekLink>
  );
}

function Branch({ nodes, slug, tasks, goals, label }: { nodes: readonly MapNode[]; slug: string; tasks: ReadonlyMap<string, TaskView>; goals: ReadonlyMap<string, GoalStatus>; label?: string }): ReactNode {
  return (
    <ul aria-label={label} className={cx(!label && "max-sm:border-l max-sm:border-rule max-sm:pl-3")}>
      {nodes.map((node) => (
        <li key={node.key} data-map-node={node.kind}>
          <NodeBox node={node} slug={slug} task={node.kind === "goal" ? undefined : tasks.get(node.id)} goalStatus={goals.get(node.id)} />
          {node.children.length > 0 && <Branch nodes={node.children} slug={slug} tasks={tasks} goals={goals} />}
        </li>
      ))}
    </ul>
  );
}

/**
 * Goals, their open tasks and those tasks' subtasks as one tree, left to right. The tree is a nested
 * list (so a screen reader hears the hierarchy), each node placed by `layoutMap`; the joining
 * curves are drawn behind it and carry no meaning of their own. It scrolls within a screen's height;
 * on a phone the list is an indented outline instead.
 */
export function TaskMap({ layout, tasks, goals, slug }: { layout: MapLayout; tasks: readonly TaskView[]; goals: readonly { id: string; status: GoalStatus }[]; slug: string }) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const statuses = new Map(goals.map((goal) => [goal.id, goal.status]));
  const width = (layout.columns - 1) * COLUMN + NODE_WIDTH;
  const height = layout.rows * ROW;
  return (
    <>
      <FlowLegend className="border-b border-rule px-5 py-2.5" />
      <div tabIndex={0} role="region" aria-label="Map of goals and tasks" className="overflow-auto px-5 py-4 sm:max-h-[calc(100dvh-14rem)]">
        <div className="relative sm:h-(--map-h) sm:w-(--map-w)" style={{ "--map-w": `${width}px`, "--map-h": `${height}px` } as CSSProperties}>
          <svg aria-hidden width={width} height={height} className="absolute inset-0 text-edge max-sm:hidden">
            {layout.edges.map(({ from, to }) => {
              const x1 = left(from) + NODE_WIDTH;
              const x2 = left(to);
              const bend = (x2 - x1) / 2;
              return (
                <path
                  key={`${from.key}>${to.key}`}
                  d={`M${x1} ${middle(from)}C${x1 + bend} ${middle(from)} ${x2 - bend} ${middle(to)} ${x2} ${middle(to)}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                />
              );
            })}
          </svg>
          <Branch nodes={layout.roots} slug={slug} tasks={byId} goals={statuses} label="Goals, their tasks and subtasks" />
        </div>
      </div>
    </>
  );
}
