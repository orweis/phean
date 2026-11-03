/** Pure hierarchy helpers shared by the MCP views and the web UI. */
import type { TaskStatus } from "./domain";

export interface TaskCounts {
  inbox: number;
  todo: number;
  in_progress: number;
  /** Inbox, to do and in progress together. */
  open: number;
  done: number;
  /** Open plus done; dropped tasks do not count toward progress. */
  total: number;
}

export interface HierarchyItem {
  id: string;
  parentId: string | null;
}

export type WithProgress<G> = G & {
  depth: number;
  own: TaskCounts;
  rollup: TaskCounts;
  /** Share of done tasks across the goal and all its descendants, 0..1. */
  progress: number;
  childCount: number;
};

export interface TreeNode<G> {
  item: G;
  children: TreeNode<G>[];
}

export const EMPTY_COUNTS: TaskCounts = { inbox: 0, todo: 0, in_progress: 0, open: 0, done: 0, total: 0 };

function addCounts(a: TaskCounts, b: TaskCounts): TaskCounts {
  const sum = { ...a };
  for (const key of Object.keys(sum) as (keyof TaskCounts)[]) sum[key] += b[key];
  return sum;
}

/** Adds `n` tasks of one status to a tally; dropped tasks are not counted. */
export function tallyStatus(counts: TaskCounts, status: TaskStatus, n: number): TaskCounts {
  if (status === "dropped") return counts;
  return {
    ...counts,
    [status]: counts[status] + n,
    open: counts.open + (status === "done" ? 0 : n),
    total: counts.total + n,
  };
}

/** Builds a forest, keeping input order among siblings. Orphans (parent filtered out) become roots. */
export function toTree<G extends HierarchyItem>(items: readonly G[]): TreeNode<G>[] {
  const nodes = new Map(items.map((item) => [item.id, { item, children: [] as TreeNode<G>[] }]));
  const roots: TreeNode<G>[] = [];
  for (const node of nodes.values()) {
    const parent = node.item.parentId ? nodes.get(node.item.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** Depth-first order (parents before children), so a flat list renders as an indented tree. */
export function flattenTree<G>(roots: readonly TreeNode<G>[], depth = 0): { item: G; depth: number }[] {
  return roots.flatMap((node) => [{ item: node.item, depth }, ...flattenTree(node.children, depth + 1)]);
}

export interface TreeGuide {
  /** For each ancestor level from 1 up to the row's depth, whether its rail continues past this row. */
  rails: boolean[];
  /** No later sibling, so the connector turns the corner instead of running on. */
  last: boolean;
}

/** Connector lines for a depth-first list drawn as a tree (the `├` and `└` of a file tree). */
export function treeGuides(rows: readonly { depth: number }[]): TreeGuide[] {
  const continues = (index: number, depth: number) => {
    for (const row of rows.slice(index + 1)) {
      if (row.depth < depth) return false;
      if (row.depth === depth) return true;
    }
    return false;
  };
  return rows.map((row, index) => ({
    rails: Array.from({ length: Math.max(0, row.depth - 1) }, (_, level) => continues(index, level + 1)),
    last: !continues(index, row.depth),
  }));
}

/** The id of `rootId` and of every goal below it. */
export function subtreeIds(items: readonly HierarchyItem[], rootId: string): string[] {
  const ids = new Set([rootId]);
  for (const id of ids) {
    for (const item of items) if (item.parentId === id) ids.add(item.id);
  }
  return [...ids];
}

/** Annotates goals with depth and task progress rolled up from every descendant. */
export function withProgress<G extends HierarchyItem>(
  goals: readonly G[],
  countsByGoal: ReadonlyMap<string, TaskCounts>,
): WithProgress<G>[] {
  const result: WithProgress<G>[] = [];

  const visit = (node: TreeNode<G>, depth: number): TaskCounts => {
    const own = countsByGoal.get(node.item.id) ?? EMPTY_COUNTS;
    const entry = { ...node.item, depth, own, rollup: own, progress: 0, childCount: node.children.length };
    result.push(entry);
    const rollup = node.children.reduce((sum, child) => addCounts(sum, visit(child, depth + 1)), own);
    entry.rollup = rollup;
    entry.progress = rollup.total === 0 ? 0 : rollup.done / rollup.total;
    return rollup;
  };

  for (const root of toTree(goals)) visit(root, 0);
  return result;
}
