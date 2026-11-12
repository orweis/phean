import { TASK_STATUSES, type TaskStatus } from "./domain";

/** The ways the Tasks page lays out the same tasks. The board is the default. */
export const TASK_LAYOUTS = ["board", "table", "calendar", "map"] as const;
export type TaskLayout = (typeof TASK_LAYOUTS)[number];

export const TASK_LAYOUT_META: Record<TaskLayout, { label: string; hint: string }> = {
  board: { label: "Board", hint: "Lanes by stage, People above Agents" },
  table: { label: "Table", hint: "Every task as a row, sortable by any column" },
  calendar: { label: "Calendar", hint: "Tasks on their due dates, a month at a time" },
  map: { label: "Map", hint: "Goals, their tasks and subtasks as one tree" },
};

/** The query values the Tasks page reads, shared by every layout so switching keeps them. */
export type TaskQuery = {
  view?: string;
  goal?: string;
  agent?: string;
  status?: string;
  lane?: string;
  sort?: string;
  dir?: string;
  month?: string;
  /** `none`: only tasks without a due date, in the table. */
  due?: string;
};

export function parseTaskLayout(value: string | undefined): TaskLayout {
  return TASK_LAYOUTS.includes(value as TaskLayout) ? (value as TaskLayout) : "board";
}

/** Which tasks a layout lists: the open ones by default, every one but dropped, or one status. */
export const STATUS_FILTERS = ["open", "all", ...TASK_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function parseStatusFilter(value: string | undefined): StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter) ? (value as StatusFilter) : "open";
}

/** Names the filters that are not statuses, for the status picker. */
export const STATUS_FILTER_LABELS: Record<Exclude<StatusFilter, TaskStatus>, string> = { open: "Open", all: "All but dropped" };

/**
 * The filters to carry from one layout to another: goal, agent and status apply to all of them;
 * a sort, a month or a phone's lane belong to one layout and are dropped on the way.
 */
export function carriedFilters(query: TaskQuery): Pick<TaskQuery, "goal" | "agent" | "status"> {
  return { goal: query.goal, agent: query.agent, status: query.status };
}
