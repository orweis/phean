import { describe, expect, it } from "vitest";

import { mcpClientSetups } from "@/lib/mcp-config";
import { queryParam, routes, safeNextPath } from "@/lib/routes";
import { parseInput } from "@/server/domain/service";
import { CreateGoalInput, RememberInput, TaskDraft, UpdateGoalInput, UpdateTaskInput } from "@/server/domain/schemas";
import { formToInput } from "@/server/forms";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("routes", () => {
  it("adds only the query values that are set", () => {
    expect(routes.board("acme")).toBe("/w/acme/board");
    expect(routes.board("acme", "g_1")).toBe("/w/acme/board?goal=g_1");
    expect(routes.memory("acme", { kind: "fact", q: undefined })).toBe("/w/acme/memory?kind=fact");
    expect(routes.search("acme", "q3 close & audit")).toBe("/w/acme/search?q=q3+close+%26+audit");
    expect(routes.signIn("/invite/inv_1")).toBe("/sign-in?next=%2Finvite%2Finv_1");
  });

  it("reads a single trimmed search param", () => {
    expect(queryParam(undefined)).toBeUndefined();
    expect(queryParam("  ")).toBeUndefined();
    expect(queryParam(" g_1 ")).toBe("g_1");
    expect(queryParam(["first", "second"])).toBe("first");
  });

  it("only follows same-origin relative redirects", () => {
    expect(safeNextPath("/w/acme")).toBe("/w/acme");
    expect(safeNextPath("//evil.example")).toBe("/workspaces");
    expect(safeNextPath("/\\evil.example")).toBe("/workspaces");
    expect(safeNextPath("https://evil.example")).toBe("/workspaces");
    expect(safeNextPath(null, "/")).toBe("/");
  });
});

describe("MCP client setup snippets", () => {
  const setups = mcpClientSetups({ url: "https://phean.test/mcp", token: "phn_secret", workspace: "acme" });

  it("covers the common clients, each with the url and bearer token", () => {
    expect(setups.map((setup) => setup.id)).toEqual(["cursor", "claude-code", "vscode"]);
    for (const setup of setups) {
      expect(setup.code).toContain("https://phean.test/mcp");
      expect(setup.code).toContain("Bearer phn_secret");
    }
  });

  it("emits valid JSON configs named after the workspace", () => {
    const cursor = JSON.parse(setups[0]!.code);
    expect(cursor.mcpServers["phean-acme"]).toEqual({
      url: "https://phean.test/mcp",
      headers: { Authorization: "Bearer phn_secret" },
    });
    expect(JSON.parse(setups[2]!.code).servers["phean-acme"].type).toBe("http");
  });
});

describe("formToInput", () => {
  it("reads declared fields only and lets the schema apply defaults", () => {
    const input = formToInput(form([["title", "Ship it"], ["workspace", "acme"], ["unknown", "x"]]), TaskDraft);
    expect(input).toEqual({ title: "Ship it" });
    expect(parseInput(TaskDraft, input)).toMatchObject({ title: "Ship it", status: "inbox", priority: "medium", tags: [] });
  });

  it("splits array fields on commas and repeated keys", () => {
    const input = formToInput(form([["content", "Use net 30"], ["tags", "billing, acme"], ["tags", "terms"]]), RememberInput);
    expect(input.tags).toEqual(["billing", "acme", "terms"]);
  });

  it("treats an empty optional select as not provided", () => {
    const input = formToInput(form([["title", "Close books"], ["parentGoalId", ""], ["dueDate", ""]]), CreateGoalInput);
    expect(input).toEqual({ title: "Close books" });
    expect(formToInput(form([["title", "x"], ["dueDate", ""]]), TaskDraft)).toEqual({ title: "x" });
  });

  it("turns an empty nullable field into null so it can be cleared", () => {
    expect(formToInput(form([["goalId", "g_1"], ["parentGoalId", ""]]), UpdateGoalInput)).toEqual({ goalId: "g_1", parentGoalId: null });
    expect(formToInput(form([["taskId", "t_1"], ["dueDate", ""]]), UpdateTaskInput)).toEqual({ taskId: "t_1", dueDate: null });
  });

  it("keeps an empty string where the schema accepts one, so text can be cleared", () => {
    expect(formToInput(form([["goalId", "g_1"], ["description", "  "]]), UpdateGoalInput)).toEqual({ goalId: "g_1", description: "" });
  });
});
