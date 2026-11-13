import { describe, expect, it } from "vitest";

import { byDueDay, gridRange, monthGrid, parseMonth } from "@/lib/calendar";
import { routes } from "@/lib/routes";
import { layoutMap } from "@/lib/task-map";
import { nextSort, parseTableSort, sortTasks, type TableTask } from "@/lib/task-table";
import { carriedFilters, parseStatusFilter, parseTaskLayout } from "@/lib/task-views";

const task = (title: string, fields: Partial<TableTask> = {}): TableTask => ({
  title,
  status: "todo",
  stage: null,
  priority: "medium",
  dueDate: null,
  goalTitle: null,
  operatorName: null,
  updatedAt: "2026-11-01T00:00:00Z",
  ...fields,
});

describe("task layouts and filters", () => {
  it("reads the layout and status from the URL, falling back to the board and no status", () => {
    expect(parseTaskLayout("table")).toBe("table");
    expect(parseTaskLayout("gantt")).toBe("board");
    expect(parseTaskLayout(undefined)).toBe("board");
    expect(parseStatusFilter("in_progress")).toBe("in_progress");
    expect(parseStatusFilter("all")).toBe("all");
    expect(parseStatusFilter("started")).toBe("open");
  });

  it("carries goal, agent and status between layouts, and drops what belongs to one", () => {
    expect(carriedFilters({ goal: "g1", agent: "a1", status: "todo", sort: "due", dir: "asc", month: "2026-11", lane: "done" })).toEqual({
      goal: "g1",
      agent: "a1",
      status: "todo",
    });
    expect(routes.board("acme", { view: "table", status: "inbox", goal: undefined })).toBe("/w/acme/board?view=table&status=inbox");
  });
});

describe("the task table", () => {
  const stageRank = (row: TableTask) => ["inbox", "todo", "in_progress", "done"].indexOf(row.status);

  it("sorts by due date, soonest first, by default, with undated tasks last either way", () => {
    const rows = [task("None"), task("Late", { dueDate: "2026-11-01" }), task("Soon", { dueDate: "2026-11-09" })];
    expect(sortTasks(rows, parseTableSort(undefined, undefined), stageRank).map((row) => row.title)).toEqual(["Late", "Soon", "None"]);
    expect(sortTasks(rows, { column: "due", direction: "desc" }, stageRank).map((row) => row.title)).toEqual(["Soon", "Late", "None"]);
  });

  it("sorts priority by urgency and stage by the flow, not by their names", () => {
    const rows = [task("Low", { priority: "low", status: "done" }), task("Urgent", { priority: "urgent", status: "inbox" }), task("High", { priority: "high", status: "in_progress" })];
    expect(sortTasks(rows, { column: "priority", direction: "asc" }, stageRank).map((row) => row.title)).toEqual(["Urgent", "High", "Low"]);
    expect(sortTasks(rows, { column: "stage", direction: "asc" }, stageRank).map((row) => row.title)).toEqual(["Urgent", "High", "Low"]);
  });

  it("keeps the incoming order for ties, and reads the newest change first on Updated", () => {
    const rows = [task("B", { updatedAt: "2026-11-01T00:00:00Z" }), task("A", { updatedAt: "2026-11-05T00:00:00Z" }), task("C", { updatedAt: "2026-11-01T00:00:00Z" })];
    expect(sortTasks(rows, parseTableSort("updated", undefined), stageRank).map((row) => row.title)).toEqual(["A", "B", "C"]);
  });

  it("flips a column that is already the sort, and starts another its natural way", () => {
    expect(nextSort({ column: "due", direction: "asc" }, "due")).toEqual({ column: "due", direction: "desc" });
    expect(nextSort({ column: "due", direction: "asc" }, "updated")).toEqual({ column: "updated", direction: "desc" });
    expect(parseTableSort("nonsense", "sideways")).toEqual({ column: "due", direction: "asc" });
  });
});

describe("the calendar", () => {
  it("lays a month out in whole Monday-first weeks, padded with the neighbouring months", () => {
    const grid = monthGrid("2026-11");
    expect(grid.title).toBe("November 2026");
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
    // November 1st 2026 is a Sunday, so the first week starts on Monday October 26th.
    expect(grid.weeks[0]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(gridRange(grid)).toEqual({ from: "2026-10-26", to: "2026-12-06" });
    expect([grid.previous, grid.next]).toEqual(["2026-10", "2026-12"]);
    expect(monthGrid("2026-12").next).toBe("2027-01");
  });

  it("falls back to this month for a missing or malformed month, and groups tasks by due day", () => {
    expect(parseMonth("2026-13", new Date("2026-11-12T10:00:00Z"))).toBe("2026-11");
    expect(parseMonth(undefined, new Date("2026-11-12T10:00:00Z"))).toBe("2026-11");
    const days = byDueDay([{ dueDate: "2026-11-09" }, { dueDate: null }, { dueDate: "2026-11-09" }]);
    expect(days.get("2026-11-09")).toHaveLength(2);
    expect(days.size).toBe(1);
  });
});

describe("the map", () => {
  it("hangs subtasks off their task and tasks off their goal, centring each parent over its children", () => {
    const layout = layoutMap(
      [{ id: "g", title: "Close the books", parentId: null }],
      [
        { id: "t1", title: "Reconcile", goalId: "g", parentTaskId: null },
        { id: "s1", title: "Cards", goalId: "g", parentTaskId: "t1" },
        { id: "s2", title: "Bank", goalId: "g", parentTaskId: "t1" },
        { id: "t2", title: "Payroll", goalId: "g", parentTaskId: null },
      ],
    );
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(3);
    const at = (key: string) => layout.nodes.find((candidate) => candidate.key === key)!;
    expect(at("task:s1")).toMatchObject({ kind: "subtask", depth: 2, row: 0 });
    expect(at("task:t1")).toMatchObject({ kind: "task", depth: 1, row: 0.5 });
    expect(at("task:t2")).toMatchObject({ depth: 1, row: 2 });
    expect(at("goal:g").row).toBe(1);
    expect(layout.edges).toHaveLength(4);
  });

  it("leaves off goals with no open work, nests sub-goals first, and gathers goalless tasks under one root", () => {
    const layout = layoutMap(
      [
        { id: "g", title: "Launch", parentId: null },
        { id: "sub", title: "Docs", parentId: "g" },
        { id: "empty", title: "Someday", parentId: null },
      ],
      [
        { id: "t1", title: "Own task", goalId: "g", parentTaskId: null },
        { id: "t2", title: "Write the quickstart", goalId: "sub", parentTaskId: null },
        { id: "t3", title: "Read the thread", goalId: null, parentTaskId: null },
      ],
    );
    expect(layout.roots.map((root) => root.title)).toEqual(["Launch", "No goal"]);
    expect(layout.roots[0]!.children.map((child) => child.title)).toEqual(["Docs", "Own task"]);
  });

  it("puts a subtask whose parent is not on the map under its goal", () => {
    const layout = layoutMap([{ id: "g", title: "Goal", parentId: null }], [{ id: "s", title: "Orphan", goalId: "g", parentTaskId: "gone" }]);
    expect(layout.roots[0]!.children[0]).toMatchObject({ kind: "task", title: "Orphan" });
  });
});
