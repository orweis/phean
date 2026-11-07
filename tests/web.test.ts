import { APIError } from "better-auth/api";
import { redirect } from "next/navigation";
import { describe, expect, it } from "vitest";

import { IDLE, stringData } from "@/lib/action-state";
import { AGENT_STATUS_META, agentAccessEnds, agentConnection, agentStatus } from "@/lib/domain";
import { mcpClientSetups } from "@/lib/mcp-config";
import { queryParam, routes, safeNextPath } from "@/lib/routes";
import { attempt, expectedErrorMessage } from "@/server/actions";
import { invalid } from "@/server/domain/errors";
import { CreateGoalInput, RememberInput, TaskDraft, UpdateGoalInput, UpdateTaskInput } from "@/server/domain/schemas";
import { parseInput } from "@/server/domain/service";
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
  const signIn = mcpClientSetups({ url: "https://x/mcp", workspace: "acme" });

  it("covers the common clients, each with the url and bearer token", () => {
    expect(setups.map((setup) => setup.id)).toEqual(["cursor", "claude-code", "vscode"]);
    for (const setup of setups) {
      expect(setup.code).toContain("https://phean.test/mcp");
      expect(setup.code).toContain("Bearer phn_secret");
    }
    expect(setups[1]!.code).toContain("Authorization: Bearer phn_");
  });

  it("emits valid JSON configs named after the workspace", () => {
    const cursor = JSON.parse(setups[0]!.code);
    expect(cursor.mcpServers["phean-acme"]).toEqual({
      url: "https://phean.test/mcp",
      headers: { Authorization: "Bearer phn_secret" },
    });
    expect(JSON.parse(setups[2]!.code).servers["phean-acme"].type).toBe("http");
  });

  it("without a token, gives only the URL so the client signs in through the browser", () => {
    expect(signIn.map((setup) => setup.id)).toEqual(["cursor", "claude-code", "vscode"]);
    const [cursor, claudeCode, vscode] = signIn;
    expect(claudeCode!.code).toBe("claude mcp add --transport http phean-acme https://x/mcp");
    expect(JSON.parse(cursor!.code)).toEqual({ mcpServers: { "phean-acme": { url: "https://x/mcp" } } });
    expect(JSON.parse(vscode!.code)).toEqual({ servers: { "phean-acme": { type: "http", url: "https://x/mcp" } } });
    for (const setup of signIn) expect(setup.code).not.toMatch(/Authorization|Bearer|header/i);
  });
});

describe("agent status and connection", () => {
  const now = new Date("2026-11-05T12:00:00Z").getTime();
  const past = new Date(now - 60_000);
  const future = new Date(now + 86_400_000);
  const agent = { revokedAt: null, lastSeenAt: new Date(now - 60_000), accessExpiresAt: null, authKind: "key" as const, sharesParentKey: false };

  it("is active, idle, expired or revoked, in that order of weight", () => {
    expect(agentStatus(agent, now)).toBe("active");
    expect(agentStatus({ ...agent, lastSeenAt: null }, now)).toBe("idle");
    expect(agentStatus({ ...agent, accessExpiresAt: future }, now)).toBe("active");
    expect(agentStatus({ ...agent, accessExpiresAt: past }, now)).toBe("expired");
    expect(agentStatus({ ...agent, accessExpiresAt: past, revokedAt: past }, now)).toBe("revoked");
  });

  it("is approver_left when the server says it cannot act, but revoked and expired still say why first", () => {
    expect(agentStatus({ ...agent, live: false }, now)).toBe("approver_left");
    expect(agentStatus({ ...agent, live: true }, now)).toBe("active");
    expect(agentStatus({ ...agent, live: false, accessExpiresAt: past }, now)).toBe("expired");
    expect(agentStatus({ ...agent, live: false, revokedAt: past }, now)).toBe("revoked");
    expect(AGENT_STATUS_META.approver_left.label).toBe("Approver left");
    expect(AGENT_STATUS_META.approver_left.tone).not.toBe(AGENT_STATUS_META.active.tone);
  });

  it("gives expired its own label and tone", () => {
    expect(AGENT_STATUS_META.expired.label).toBe("Expired");
    expect(AGENT_STATUS_META.expired.tone).not.toBe(AGENT_STATUS_META.revoked.tone);
    expect(AGENT_STATUS_META.expired.tone).not.toBe(AGENT_STATUS_META.idle.tone);
  });

  it("ends a sub-agent's access when its parent's ends, if that is sooner", () => {
    expect(agentAccessEnds(agent)).toBeNull();
    expect(agentAccessEnds({ ...agent, accessExpiresAt: future })).toEqual(future);
    expect(agentAccessEnds(agent, { accessExpiresAt: past })).toEqual(past);
    expect(agentAccessEnds({ ...agent, accessExpiresAt: past }, { accessExpiresAt: future })).toEqual(past);
    expect(agentAccessEnds({ ...agent, accessExpiresAt: future }, { accessExpiresAt: null })).toEqual(future);
  });

  it("names how an agent connects", () => {
    expect(agentConnection({ authKind: "oauth", sharesParentKey: false })).toBe("oauth");
    expect(agentConnection({ authKind: "key", sharesParentKey: false })).toBe("key");
    expect(agentConnection({ authKind: "key", sharesParentKey: true })).toBe("shared_key");
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

describe("form action results", () => {
  it("turns expected failures into a form error and lets everything else through", async () => {
    await expect(attempt(async () => 42)).resolves.toEqual({ ok: true, value: 42 });
    await expect(attempt(() => Promise.reject(invalid("Title is required.")))).resolves.toEqual({
      ok: false,
      state: { status: "error", message: "Title is required.", at: expect.any(Number) },
    });
    expect(expectedErrorMessage(new APIError("BAD_REQUEST", { message: "User already exists" }))).toBe("User already exists");

    const crash = new Error("connection reset");
    expect(expectedErrorMessage(crash)).toBeNull();
    await expect(attempt(() => Promise.reject(crash))).rejects.toBe(crash);
    await expect(attempt(async () => redirect("/w/acme"))).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT/) });
  });

  it("hands back named strings only when every one is there", () => {
    const issued = { status: "success" as const, data: { token: "phn_secret", name: "Scout", count: 2 } };
    expect(stringData(issued, "token", "name")).toEqual({ token: "phn_secret", name: "Scout" });
    expect(stringData(issued, "token", "count")).toBeNull();
    expect(stringData(IDLE, "token")).toBeNull();
  });
});
