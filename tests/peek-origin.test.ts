import { describe, expect, it } from "vitest";

import { isPeekPath, peekOrigin } from "@/lib/peek-origin";
import { routes } from "@/lib/routes";

describe("where a task's peek opened, for analytics", () => {
  it("names the Tasks page's layout, the board when there is no view", () => {
    expect(peekOrigin(routes.board("acme"), null)).toBe("board");
    expect(peekOrigin(routes.board("acme"), "table")).toBe("table");
    expect(peekOrigin(routes.board("acme"), "calendar")).toBe("calendar");
    expect(peekOrigin(routes.board("acme"), "map")).toBe("map");
    expect(peekOrigin(routes.board("acme"), "nonsense")).toBe("board");
  });

  it("names search, decisions and goals, and every other page as other", () => {
    expect(peekOrigin(routes.search("acme"), null)).toBe("search");
    expect(peekOrigin(routes.decisions("acme"), null)).toBe("decisions");
    expect(peekOrigin(routes.goals("acme"), null)).toBe("goals");
    expect(peekOrigin(routes.goal("acme", "g_1"), null)).toBe("goals");
    expect(peekOrigin(routes.workspace("acme"), null)).toBe("other");
    expect(peekOrigin(routes.timeline("acme"), null)).toBe("other");
    // A slug that reads like a page is still a slug.
    expect(peekOrigin("/w/search", null)).toBe("other");
  });

  it("knows a peek's own path is never where a peek opened from", () => {
    expect(isPeekPath(routes.task("acme", "t_1"))).toBe(true);
    expect(isPeekPath(routes.document("acme", "d_1"))).toBe(true);
    expect(isPeekPath(routes.board("acme"))).toBe(false);
    expect(isPeekPath(routes.goal("acme", "g_1"))).toBe(false);
  });
});
