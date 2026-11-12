import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { routes } from "@/lib/routes";
import { bestMatches, matchScore, orderSuggestions, pageSuggestions, PER_GROUP, statusSuggestions, type Suggestion } from "@/lib/suggestions";
import { attachDocument } from "@/server/domain/documents";
import { createGoal } from "@/server/domain/goals";
import { remember } from "@/server/domain/memory";
import { suggest } from "@/server/domain/search";
import { captureTasks, type Task } from "@/server/domain/tasks";

import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";

describe("matching what a person types", () => {
  it("ranks a start over a word's start over anywhere, ignoring case and accents", () => {
    expect(matchScore("Invoices", "inv")).toBe(3);
    expect(matchScore("Chase overdue invoices", "INV")).toBe(2);
    expect(matchScore("Reinvoice", "inv")).toBe(1);
    expect(matchScore("Café plans", "cafe")).toBe(3);
    expect(matchScore("Payroll", "inv")).toBe(0);
    expect(matchScore("Anything", "  ")).toBe(0);
  });

  it("keeps the strongest matches, in their own order on a tie, up to the limit", () => {
    const words = ["Reinvent", "Invoice", "Late invoice", "Inventory", "Payroll"];
    expect(bestMatches(words, "inv", (word) => word)).toEqual(["Invoice", "Inventory", "Late invoice", "Reinvent"]);
    expect(bestMatches(words, "inv", (word) => word, 2)).toEqual(["Invoice", "Inventory"]);
  });

  it("finds pages by name or by another word for them, and statuses as task filters", () => {
    expect(pageSuggestions("acme", "kanban")).toEqual([{ group: "page", key: "page:tasks", label: "Tasks", detail: "kanban", href: routes.board("acme") }]);
    expect(pageSuggestions("acme", "dec")).toEqual([{ group: "page", key: "page:decisions", label: "Decisions", detail: undefined, href: routes.decisions("acme") }]);
    // Letters inside a word ("find", "Timeline") do not count: only a name or word that starts with
    // them, and a page found by another word says which.
    expect(pageSuggestions("acme", "in").map((page) => [page.label, page.detail])).toEqual([["Members", "invite"]]);
    expect(statusSuggestions("acme", "in pro")).toEqual([
      { group: "filter", key: "status:in_progress", label: "In progress tasks", detail: "As a table", href: routes.tasksByStatus("acme", "in_progress") },
    ]);
  });

  it("orders suggestions by group and keeps each group short", () => {
    const many: Suggestion[] = Array.from({ length: 6 }, (_, index) => ({ group: "task", key: `task:${index}`, label: `Task ${index}`, href: "/" }));
    const ordered = orderSuggestions([...many, { group: "page", key: "page:tasks", label: "Tasks", href: "/" }]);
    expect(ordered[0]!.group).toBe("page");
    expect(ordered.filter((suggestion) => suggestion.group === "task")).toHaveLength(PER_GROUP);
  });
});

describe("the suggest service", () => {
  let testDb: TestDb;
  let acme: Workspace;
  let task: Task;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  beforeEach(async () => {
    acme = await seedWorkspace(testDb.db);
    const goal = await createGoal(acme.human, { title: "Close the invoices backlog" });
    [task] = (await captureTasks(acme.scout.ctx, { tasks: [{ title: "Chase three overdue invoices", goalId: goal.id }] })).created as [Task];
    await remember(acme.human, { content: "Invoices go out on the first working day", kind: "preference" });
    await attachDocument(acme.scout.ctx, { title: "Invoice chasing script", taskId: task.id, content: "Hello" });
  });

  afterAll(() => testDb.close());

  it("offers goals, tasks, documents and memory that match, each with where it leads", async () => {
    const suggestions = await suggest(acme.human, { query: "invoic" });
    const slug = acme.tenant.slug;
    expect(suggestions.map((suggestion) => suggestion.group)).toEqual(["goal", "task", "document", "memory"]);
    // Memories collapse into one way in, the Memory page searched for the words.
    expect(suggestions.find((suggestion) => suggestion.group === "task")).toMatchObject({ label: "Chase three overdue invoices", detail: "Inbox", href: routes.task(slug, task.id) });
    expect(suggestions.find((suggestion) => suggestion.group === "document")).toMatchObject({ detail: "Chase three overdue invoices" });
    expect(suggestions.find((suggestion) => suggestion.group === "memory")).toMatchObject({ label: "1 memory matches", href: routes.memory(slug, { q: "invoic" }) });
  });

  it("offers an agent as a filter on what it holds, and pages by name", async () => {
    const suggestions = await suggest(acme.human, { query: "scou" });
    expect(suggestions).toEqual([
      { group: "filter", key: `held:${acme.scout.agentId}`, label: "Held by Scout", detail: "Agent's tasks", href: routes.board(acme.tenant.slug, { agent: acme.scout.agentId }) },
    ]);
    expect((await suggest(acme.human, { query: "memo" }))[0]).toMatchObject({ group: "page", label: "Memory" });
  });

  it("finds things from a two-letter start, even one that is a stopword", async () => {
    const labels = (await suggest(acme.human, { query: "in" })).map((suggestion) => suggestion.label);
    expect(labels).toEqual(expect.arrayContaining(["Inbox tasks", "In progress tasks", "Chase three overdue invoices", "Close the invoices backlog"]));
  });

  it("finds a whole word that is longer than its stem", async () => {
    // "invoices" is stored as the stem "invoic", which "invoice" does not start with as written.
    expect((await suggest(acme.human, { query: "invoice" })).map((suggestion) => suggestion.label)).toContain("Chase three overdue invoices");
  });

  it("suggests nothing from another workspace", async () => {
    const globex = await seedWorkspace(testDb.db, { name: "Globex" });
    expect((await suggest(globex.human, { query: "invoic" })).filter((suggestion) => suggestion.group !== "page")).toEqual([]);
  });
});
