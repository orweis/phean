/**
 * The Map layout: goals, their tasks and those tasks' subtasks as one tree, read left to right.
 * Phean has no task dependencies, so the graph it draws is the hierarchy it does have. The maths
 * is here (and tested); `components/task-map.tsx` draws it.
 */

export interface MapGoal {
  id: string;
  title: string;
  parentId: string | null;
}

export interface MapTask {
  id: string;
  title: string;
  goalId: string | null;
  parentTaskId: string | null;
}

export type MapNodeKind = "goal" | "task" | "subtask" | "loose";

export interface MapNode {
  /** `goal:<id>`, `task:<id>`, or `loose` for the root of tasks with no goal. */
  key: string;
  id: string;
  kind: MapNodeKind;
  title: string;
  /** The column: how deep in the tree. */
  depth: number;
  /** The row the node is centred on, in leaf rows (fractional for a parent over several leaves). */
  row: number;
  children: MapNode[];
}

export interface MapLayout {
  roots: MapNode[];
  /** Every node, depth first, for drawing. */
  nodes: MapNode[];
  edges: { from: MapNode; to: MapNode }[];
  rows: number;
  columns: number;
}

/**
 * Builds the tree and places it: each leaf takes the next row and each parent sits centred on the
 * rows of the leaves under it. Goals keep their own nesting; a goal with nothing open
 * under it (no tasks, no sub-goals with tasks) is left off so the map shows the work. Tasks whose
 * goal is not on the map, or that have none, hang off one "No goal" root.
 */
export function layoutMap(goals: readonly MapGoal[], tasks: readonly MapTask[]): MapLayout {
  const node = (key: string, id: string, kind: MapNodeKind, title: string): MapNode => ({ key, id, kind, title, depth: 0, row: 0, children: [] });
  const goalNodes = new Map(goals.map((goal) => [goal.id, node(`goal:${goal.id}`, goal.id, "goal", goal.title)]));
  const taskIds = new Set(tasks.map((task) => task.id));
  const taskNodes = new Map(tasks.map((task) => [task.id, node(`task:${task.id}`, task.id, task.parentTaskId && taskIds.has(task.parentTaskId) ? "subtask" : "task", task.title)]));
  const loose = node("loose", "", "loose", "No goal");

  for (const task of tasks) {
    const own = taskNodes.get(task.id)!;
    const parent = task.parentTaskId ? taskNodes.get(task.parentTaskId) : undefined;
    if (parent) parent.children.push(own);
    else (task.goalId ? (goalNodes.get(task.goalId) ?? loose) : loose).children.push(own);
  }
  const roots: MapNode[] = [];
  for (const goal of goals) {
    const own = goalNodes.get(goal.id)!;
    const parent = goal.parentId ? goalNodes.get(goal.parentId) : undefined;
    // Sub-goals go before the parent's own tasks, so the tree reads outcome first, then work.
    if (parent) parent.children.splice(parent.children.filter((child) => child.kind === "goal").length, 0, own);
    else roots.push(own);
  }
  if (loose.children.length) roots.push(loose);

  const hasWork = (candidate: MapNode): boolean => candidate.kind !== "goal" || candidate.children.some(hasWork);
  const prune = (list: MapNode[]): MapNode[] =>
    list.filter(hasWork).map((kept) => {
      kept.children = prune(kept.children);
      return kept;
    });
  const kept = prune(roots);

  const nodes: MapNode[] = [];
  const edges: MapLayout["edges"] = [];
  let next = 0;
  let columns = 0;
  // Returns the first and last leaf rows under a node; the node sits midway between them.
  const place = (current: MapNode, depth: number): [number, number] => {
    current.depth = depth;
    columns = Math.max(columns, depth + 1);
    nodes.push(current);
    if (!current.children.length) {
      current.row = next++;
      return [current.row, current.row];
    }
    const spans = current.children.map((child) => {
      edges.push({ from: current, to: child });
      return place(child, depth + 1);
    });
    const span: [number, number] = [spans[0]![0], spans.at(-1)![1]];
    current.row = (span[0] + span[1]) / 2;
    return span;
  };
  for (const root of kept) place(root, 0);
  return { roots: kept, nodes, edges, rows: next, columns };
}
