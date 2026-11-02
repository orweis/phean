/** Pure hierarchy helpers shared by the MCP views and the web UI. */

export interface TaskCounts {
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

export const EMPTY_COUNTS: TaskCounts = { open: 0, done: 0, total: 0 };

function addCounts(a: TaskCounts, b: TaskCounts): TaskCounts {
  return { open: a.open + b.open, done: a.done + b.done, total: a.total + b.total };
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
