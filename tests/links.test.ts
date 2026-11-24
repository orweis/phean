import { describe, expect, it } from "vitest";

import { isLinkableId, linkKindOf, linkKindOfPath, pathOf } from "@/lib/links";
import { routes } from "@/lib/routes";
import { withUrls } from "@/server/mcp/links";

describe("links to things in Phean", () => {
  it("maps each kind of id to the page that shows it", () => {
    expect(pathOf("acme", "t_abc123")).toBe("/w/acme/tasks/t_abc123");
    expect(pathOf("acme", "g_abc123")).toBe("/w/acme/goals/g_abc123");
    expect(pathOf("acme", "d_abc123")).toBe("/w/acme/documents/d_abc123");
    expect(pathOf("acme", "m_abc123")).toBe("/w/acme/memory?focus=m_abc123");
    expect(pathOf("acme", "q_abc123")).toBe("/w/acme/decisions?focus=q_abc123");
    expect(routes.link("acme", "t_abc123")).toBe("/w/acme/link/t_abc123");
  });

  it("names the kind of thing an id or a path shows, for analytics, never the id itself", () => {
    expect(linkKindOf("t_abc123")).toBe("task");
    expect(linkKindOf("ag_abc123")).toBeNull();
    expect(linkKindOfPath(routes.task("acme", "t_abc123"))).toBe("task");
    expect(linkKindOfPath(routes.goal("acme", "g_abc123"))).toBe("goal");
    expect(linkKindOfPath(routes.request("acme", "q_abc123"))).toBe("request");
    expect(linkKindOfPath(routes.memoryItem("acme", "m_abc123"))).toBe("memory");
    expect(linkKindOfPath(routes.document("acme", "d_abc123"))).toBe("document");
    expect(linkKindOfPath(routes.pipeline("acme", "p_abc123"))).toBe("pipeline");
    expect(linkKindOfPath(routes.pipelineRun("acme", "r_abc123"))).toBe("run");
    // A slug that looks like an id names nothing.
    expect(linkKindOfPath("/w/t_abc/settings")).toBeNull();
    expect(linkKindOfPath("/w/acme/tasks")).toBeNull();
  });

  it("links nothing else: agents, webhooks, malformed ids", () => {
    for (const id of ["ag_abc123", "wh_abc123", "t_", "t_../x", "x", 42, null]) expect(isLinkableId(id)).toBe(false);
    expect(pathOf("acme", "ag_abc123")).toBeNull();
  });

  it("adds an absolute url to each linkable thing in a result, nested or listed, and keeps what is there", () => {
    const absolute = (path: string) => `https://phean.test${path}`;
    const result = withUrls(
      {
        task: {
          id: "t_1",
          inputRequest: { id: "q_1", question: "Which?" },
          inputAnswers: [{ id: "q_0" }],
          documents: [{ id: "d_1", title: "Draft" }],
          links: [{ url: "https://mail.example.com/1", title: "Email" }],
          claimedByAgentId: "ag_1",
          claimedAt: new Date("2026-11-16T00:00:00Z"),
        },
        activity: [{ id: 7, entityType: "task", entityId: "t_1" }, { id: 8, entityType: "agent", entityId: "ag_1" }],
        document: { id: "d_2" },
        url: "https://phean.test/w/acme/documents/d_2",
      },
      "acme",
      absolute,
    );
    expect(result.task).toMatchObject({
      url: "https://phean.test/w/acme/tasks/t_1",
      inputRequest: { url: "https://phean.test/w/acme/decisions?focus=q_1" },
      inputAnswers: [{ url: "https://phean.test/w/acme/decisions?focus=q_0" }],
      documents: [{ url: "https://phean.test/w/acme/documents/d_1" }],
      links: [{ url: "https://mail.example.com/1" }],
    });
    expect(result.task.claimedAt).toBeInstanceOf(Date);
    expect(result.activity).toEqual([
      { id: 7, entityType: "task", entityId: "t_1", url: "https://phean.test/w/acme/tasks/t_1" },
      { id: 8, entityType: "agent", entityId: "ag_1" },
    ]);
    expect(result.document).toEqual({ id: "d_2", url: "https://phean.test/w/acme/documents/d_2" });
  });
});
