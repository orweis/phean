import { describe, expect, it } from "vitest";

import { EMPTY_COUNTS } from "@/lib/goal-tree";
import type { GoalWithProgress } from "@/server/domain/goals";
import type { Board } from "@/server/domain/overview";
import type { TaskView } from "@/server/domain/tasks";
import { goalTreeMermaid, kanbanMermaid, timelineMermaid } from "@/server/mcp/views";

const goal = (id: string, parentId: string | null, title: string, status: GoalWithProgress["status"] = "active") =>
  ({ id, parentId, title, status, own: EMPTY_COUNTS, rollup: { open: 1, done: 1, total: 2 }, depth: 0, progress: 0.5, childCount: 0 }) as GoalWithProgress;

const task = (id: string, title: string, extra: Partial<TaskView> = {}) =>
  ({ id, title, status: "todo", priority: "medium", goalId: null, goalTitle: null, claimedByName: null, dueDate: null, ...extra }) as TaskView;

describe("Mermaid views", () => {
  it("draws the goal hierarchy with escaped labels and status classes", () => {
    const mermaid = goalTreeMermaid(
      [goal("g_1", null, 'Ship "v2" [beta]'), goal("g_2", "g_1", "Docs", "proposed")],
      [task("t_1", "Write: intro", { goalId: "g_2" })],
    );
    expect(mermaid).toContain('g_1["Ship v2 beta<br/>Active · 1/2 done"]');
    expect(mermaid).toContain('t_1(["Write intro · To do"])');
    expect(mermaid).toContain("g_1 --> g_2");
    expect(mermaid).toContain("g_2 -.- t_1");
    expect(mermaid).toContain("class g_2 proposed");
    expect(goalTreeMermaid([])).toContain("No goals yet");
  });

  it("caps kanban columns and shows who holds each task", () => {
    const board: Board = {
      columns: [
        { status: "inbox", tasks: Array.from({ length: 17 }, (_, i) => task(`t_${i}`, `Item ${i}`)) },
        { status: "todo", tasks: [] },
        { status: "in_progress", tasks: [task("t_x", "Invoices", { claimedByName: "Scout" })] },
        { status: "done", tasks: [] },
      ],
    };
    const mermaid = kanbanMermaid(board);
    expect(mermaid).toContain("inbox_more[+2 more]");
    expect(mermaid).toContain("t_x[Invoices · Scout]");
  });

  it("groups the timeline by goal and marks done, active, and urgent work", () => {
    const mermaid = timelineMermaid([
      task("t_1", "File taxes", { dueDate: "2026-04-15", priority: "urgent", goalTitle: "Finance" }),
      task("t_2", "Pay rent", { dueDate: "2026-05-01", status: "done", goalTitle: "Finance" }),
      task("t_3", "Undated", {}),
    ]);
    expect(mermaid).toContain("section Finance");
    expect(mermaid).toContain("File taxes :crit, t_1, 2026-04-15, 1d");
    expect(mermaid).toContain("Pay rent :done, t_2, 2026-05-01, 1d");
    expect(mermaid).not.toContain("Undated");
  });
});
