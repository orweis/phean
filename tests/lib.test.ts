import { describe, expect, it } from "vitest";

import { groupActivity, type ActivityLike } from "@/lib/activity";
import { formatDueDate, percent, pluralize, timeAgo, truncate } from "@/lib/format";
import { flattenTree, subtreeIds, toTree, withProgress } from "@/lib/goal-tree";
import { prefixTsQuery } from "@/server/db/fts";

describe("goal tree helpers", () => {
  const goals = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: null },
    { id: "orphan", parentId: "missing" },
  ];

  it("flattens depth-first with parents before children", () => {
    expect(flattenTree(toTree(goals)).map(({ item, depth }) => `${item.id}:${depth}`)).toEqual([
      "a:0",
      "b:1",
      "c:2",
      "d:0",
      "orphan:0",
    ]);
  });

  it("rolls progress up from descendants and ignores dropped work", () => {
    const counts = new Map([
      ["a", { open: 1, done: 0, total: 1 }],
      ["c", { open: 0, done: 3, total: 3 }],
    ]);
    const byId = new Map(withProgress(goals, counts).map((goal) => [goal.id, goal]));
    expect(byId.get("a")).toMatchObject({ rollup: { open: 1, done: 3, total: 4 }, progress: 0.75, childCount: 1 });
    expect(byId.get("b")).toMatchObject({ own: { total: 0 }, progress: 1, depth: 1 });
    expect(byId.get("d")).toMatchObject({ progress: 0 });
  });

  it("collects a subtree and tolerates cycles", () => {
    expect(subtreeIds(goals, "a").sort()).toEqual(["a", "b", "c"]);
    expect(subtreeIds([{ id: "x", parentId: "y" }, { id: "y", parentId: "x" }], "x").sort()).toEqual(["x", "y"]);
  });
});

describe("activity grouping", () => {
  const at = (minutesAgo: number) => new Date(Date.UTC(2026, 0, 1, 12, 0) - minutesAgo * 60_000);
  let nextId = 100;
  const event = (actorId: string, action: string, minutesAgo: number, summary = action): ActivityLike => ({
    id: nextId--,
    actorType: "agent",
    actorId,
    actorName: actorId,
    action,
    summary,
    createdAt: at(minutesAgo),
  });

  it("collapses bursts by the same actor and keeps the newest-first order", () => {
    const groups = groupActivity([
      event("scout", "task.captured", 0),
      event("scout", "task.captured", 1),
      event("scout", "task.captured", 2),
      event("closer", "task.claimed", 3, 'claimed "Invoices"'),
      event("scout", "task.captured", 4),
      event("scout", "task.captured", 60),
      event("scout", "memory.saved", 61),
      event("scout", "memory.saved", 62),
    ]);
    expect(groups.map((group) => [group.latest.actorId, group.summary, group.events.length])).toEqual([
      ["scout", "captured 3 tasks", 3],
      ["closer", 'claimed "Invoices"', 1],
      ["scout", "task.captured", 1],
      ["scout", "task.captured", 1],
      ["scout", "saved 2 memories", 2],
    ]);
  });
});

describe("full-text query building", () => {
  it("builds safe prefix queries", () => {
    expect(prefixTsQuery("Audit plan")).toBe("audit:* & plan:*");
    expect(prefixTsQuery("o'reilly & co | !")).toBe("o:* & reilly:* & co:*");
    expect(prefixTsQuery("Ünïcode 2026")).toBe("ünïcode:* & 2026:*");
    expect(prefixTsQuery("!!! ???")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats counts, text, dates, and relative times", () => {
    expect(pluralize(1, "task")).toBe("1 task");
    expect(pluralize(3, "memory", "memories")).toBe("3 memories");
    expect(truncate("a  b\n c", 10)).toBe("a b c");
    expect(truncate("abcdefghijk", 5)).toBe("abcd…");
    expect(formatDueDate("2026-03-01")).toBe("Mar 1");
    expect(percent(0.456)).toBe("46%");
    const now = new Date("2026-01-01T12:00:00Z");
    expect(timeAgo(new Date("2026-01-01T11:58:00Z"), now)).toBe("2 minutes ago");
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo(now, now)).toBe("just now");
  });
});
