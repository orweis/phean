import { PRIORITIES, type Priority, type TaskStatus } from "./domain";

/** What a table row needs of a task; `TaskView` has all of it. */
export interface TableTask {
  title: string;
  status: TaskStatus;
  stage: string | null;
  priority: Priority;
  dueDate: string | null;
  goalTitle: string | null;
  claimedByName: string | null;
  updatedAt: Date | string;
}

export const TABLE_COLUMNS = ["title", "stage", "priority", "due", "goal", "holder", "updated"] as const;
export type TableColumn = (typeof TABLE_COLUMNS)[number];
export type SortDirection = "asc" | "desc";

export const TABLE_COLUMN_LABELS: Record<TableColumn, string> = {
  title: "Task",
  stage: "Stage",
  priority: "Priority",
  due: "Due",
  goal: "Goal",
  holder: "Held by",
  updated: "Updated",
};

/** The way each column reads most usefully first: soonest due, most urgent, newest change. */
const FIRST_DIRECTION: Record<TableColumn, SortDirection> = {
  title: "asc",
  stage: "asc",
  priority: "asc",
  due: "asc",
  goal: "asc",
  holder: "asc",
  updated: "desc",
};

export interface TableSort {
  column: TableColumn;
  direction: SortDirection;
}

/** The table's sort from the URL; due date, soonest first, when none is given or it is unknown. */
export function parseTableSort(column: string | undefined, direction: string | undefined): TableSort {
  const known = TABLE_COLUMNS.includes(column as TableColumn) ? (column as TableColumn) : "due";
  const dir = direction === "asc" || direction === "desc" ? direction : FIRST_DIRECTION[known];
  return { column: known, direction: dir };
}

/** What a column heading's link sorts by: the other way when it is already the sort, else its natural first way. */
export function nextSort(current: TableSort, column: TableColumn): TableSort {
  if (current.column === column) return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  return { column, direction: FIRST_DIRECTION[column] };
}

const byText = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base", numeric: true });

/**
 * Sorts a copy of `tasks`. Empty values (no due date, no goal, no holder) always go last, whichever
 * way the column runs, and ties keep the order the tasks came in. `stageRank` places a task's stage
 * in the workspace's flow, so Stage sorts the way the board reads rather than alphabetically.
 */
export function sortTasks<T extends TableTask>(tasks: readonly T[], sort: TableSort, stageRank: (task: T) => number): T[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  const value = (task: T): string | number | null => {
    switch (sort.column) {
      case "title":
        return task.title;
      case "stage":
        return stageRank(task);
      case "priority":
        return PRIORITIES.indexOf(task.priority);
      case "due":
        return task.dueDate;
      case "goal":
        return task.goalTitle;
      case "holder":
        return task.claimedByName;
      case "updated":
        return new Date(task.updatedAt).getTime();
    }
  };
  return tasks
    .map((task, index) => ({ task, index, key: value(task) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) return a.key === b.key ? a.index - b.index : a.key === null ? 1 : -1;
      const order = typeof a.key === "number" && typeof b.key === "number" ? a.key - b.key : byText(String(a.key), String(b.key));
      return order === 0 ? a.index - b.index : sign * order;
    })
    .map(({ task }) => task);
}
