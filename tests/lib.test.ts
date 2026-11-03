import { describe, expect, it } from "vitest";

import { groupActivity, type ActivityLike } from "@/lib/activity";
import {
  isResumeUrl,
  isWebUrl,
  MAX_SESSIONS,
  movesSession,
  resumeLabel,
  sessionOfAsker,
  withSession,
  type AgentSession,
} from "@/lib/agent-sessions";
import { appearanceCookie, colorSchemeFor, parseAppearance, themeColorFor } from "@/lib/appearance";
import { addDays, dayOf, daysBetween, isoDate, isoDayFromToday, isPastDue, startOfUtcDay, todayIso } from "@/lib/dates";
import {
  isLate,
  isOneOf,
  isOpenTaskStatus,
  LIMITS,
  OPEN_TASK_STATUSES,
  slugify,
  STATIONS,
  TASK_STATUSES,
  WORKSPACE_SLUG_PATTERN,
  zeroCounts,
} from "@/lib/domain";
import { formatDueDate, percent, pluralize, relativeDue, timeAgo, truncate } from "@/lib/format";
import { EMPTY_COUNTS, flattenTree, subtreeIds, tallyStatus, toTree, treeGuides, withProgress } from "@/lib/goal-tree";
import { patchOf } from "@/server/db/columns";
import { prefixTsQuery } from "@/server/db/fts";

describe("calendar dates", () => {
  const lateEvening = new Date("2026-03-15T23:30:00Z");

  it("does day arithmetic in UTC", () => {
    expect(startOfUtcDay(lateEvening).toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(addDays(lateEvening, -15).toISOString()).toBe("2026-02-28T23:30:00.000Z");
    expect(dayOf("2026-03-01").toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(isoDate(lateEvening)).toBe("2026-03-15");
    expect(todayIso(lateEvening)).toBe("2026-03-15");
    expect(isoDayFromToday(1, lateEvening)).toBe("2026-03-16");
    expect(isoDayFromToday(-15, lateEvening)).toBe("2026-02-28");
    expect(daysBetween(dayOf("2026-03-01"), lateEvening)).toBe(14);
    expect(daysBetween(lateEvening, dayOf("2026-03-01"))).toBe(-14);
  });

  it("counts open work as late only once its due day has ended", () => {
    expect(isPastDue(null, lateEvening)).toBe(false);
    expect(isPastDue("2026-03-15", lateEvening)).toBe(false);
    expect(isPastDue("2026-03-14", lateEvening)).toBe(true);
    expect(isLate({ status: "todo", dueDate: "2026-03-14" }, lateEvening)).toBe(true);
    expect(isLate({ status: "in_progress", dueDate: "2026-03-15" }, lateEvening)).toBe(false);
    expect(isLate({ status: "done", dueDate: "2026-03-14" }, lateEvening)).toBe(false);
    expect(isLate({ status: "dropped", dueDate: "2026-03-14" }, lateEvening)).toBe(false);
  });
});

describe("domain vocabulary", () => {
  it("narrows untrusted values and fills in missing counts", () => {
    expect(isOneOf(TASK_STATUSES, "todo")).toBe(true);
    expect(isOneOf(TASK_STATUSES, "TODO")).toBe(false);
    expect(isOneOf(TASK_STATUSES, undefined)).toBe(false);
    expect(isOneOf([14, 30], 30)).toBe(true);
    expect(isOneOf([14, 30], "30")).toBe(false);
    expect(zeroCounts(STATIONS)).toEqual({ inbox: 0, todo: 0, in_progress: 0, done: 0 });
    expect(TASK_STATUSES.filter(isOpenTaskStatus)).toEqual([...OPEN_TASK_STATUSES]);
  });

  it("suggests workspace slugs that the slug pattern accepts", () => {
    expect(slugify("Acme Corp.")).toBe("acme-corp");
    expect(slugify("Société Générale")).toBe("societe-generale");
    expect(slugify("--Edge--case--")).toBe("edge-case");
    expect(slugify(`${"x".repeat(LIMITS.slug - 1)}-tail`)).toBe("x".repeat(LIMITS.slug - 1));
    expect(slugify("x".repeat(60))).toHaveLength(LIMITS.slug);
    expect(slugify("!!!")).toBe("");

    const schemaPattern = new RegExp(`^${WORKSPACE_SLUG_PATTERN}$`);
    // Browsers compile an input's `pattern` with the v flag, which rejects an unescaped "-" in a class.
    const htmlPattern = new RegExp(`^(?:${WORKSPACE_SLUG_PATTERN})$`, "v");
    for (const name of ["Acme Corp.", "Société Générale", "a", "--Edge--case--", "x".repeat(60), "Q3 / 2026 plan"]) {
      expect(slugify(name)).toMatch(schemaPattern);
      expect(slugify(name)).toMatch(htmlPattern);
    }
    for (const bad of ["-acme", "acme-", "Acme", "ac me", "a".repeat(LIMITS.slug + 1)]) {
      expect(bad).not.toMatch(schemaPattern);
    }
  });
});

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
      ["a", tallyStatus(tallyStatus(EMPTY_COUNTS, "todo", 1), "dropped", 5)],
      ["c", tallyStatus(EMPTY_COUNTS, "done", 3)],
    ]);
    const byId = new Map(withProgress(goals, counts).map((goal) => [goal.id, goal]));
    expect(byId.get("a")).toMatchObject({ rollup: { todo: 1, open: 1, done: 3, total: 4 }, progress: 0.75, childCount: 1 });
    expect(byId.get("b")).toMatchObject({ own: { total: 0 }, progress: 1, depth: 1 });
    expect(byId.get("d")).toMatchObject({ progress: 0 });
  });

  it("draws tree connectors: rails continue past a row only while a later sibling is coming", () => {
    const rows = [0, 1, 2, 1, 2, 0].map((depth) => ({ depth }));
    expect(treeGuides(rows)).toEqual([
      { rails: [], last: false },
      { rails: [], last: false },
      { rails: [true], last: true },
      { rails: [], last: true },
      { rails: [false], last: true },
      { rails: [], last: true },
    ]);
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

describe("query helpers", () => {
  it("builds safe prefix queries", () => {
    expect(prefixTsQuery("Audit plan")).toBe("audit:* & plan:*");
    expect(prefixTsQuery("o'reilly & co | !")).toBe("o:* & reilly:* & co:*");
    expect(prefixTsQuery("Ünïcode 2026")).toBe("ünïcode:* & 2026:*");
    expect(prefixTsQuery("!!! ???")).toBeNull();
  });

  it("patches only the fields an update was given, keeping null as a clear", () => {
    expect(patchOf({ title: "New", dueDate: null, goalId: undefined, tags: [] })).toEqual({ title: "New", dueDate: null, tags: [] });
    expect(patchOf({ title: undefined })).toEqual({});
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
    expect(relativeDue("2026-01-01", now)).toBe("Today");
    expect(relativeDue("2026-01-02", now)).toBe("Tomorrow");
    expect(relativeDue("2026-01-05", now)).toBe("In 4 days");
    expect(relativeDue("2025-12-30", now)).toBe("2 days late");
  });
});

describe("appearance", () => {
  it("falls back to following the system for a missing or unknown choice", () => {
    expect(parseAppearance("dark")).toBe("dark");
    expect(parseAppearance("light")).toBe("light");
    expect(parseAppearance(undefined)).toBe("system");
    expect(parseAppearance("sepia")).toBe("system");
  });

  it("gives the browser chrome the paper of the chosen appearance, or of the device's under System", () => {
    expect(themeColorFor("system", "light")).toBe("#f7f5fb");
    expect(themeColorFor("system", "dark")).toBe("#0e0d17");
    expect(themeColorFor("dark", "light")).toBe("#0e0d17");
    expect(themeColorFor("light", "dark")).toBe("#f7f5fb");
    expect(colorSchemeFor("system")).toBe("light dark");
    expect(colorSchemeFor("dark")).toBe("dark");
  });

  it("keeps the choice for a year, and only over HTTPS when the page is secure", () => {
    expect(appearanceCookie("dark", true)).toBe("phean-appearance=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    expect(appearanceCookie("system", false)).not.toContain("Secure");
  });
});

describe("agent sessions", () => {
  const session = (agentId: string, overrides: Partial<AgentSession> = {}): AgentSession => ({
    agentId,
    agentName: agentId,
    app: null,
    url: null,
    sessionId: `${agentId}-1`,
    messageId: null,
    command: null,
    brief: "",
    linkedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

  it("links to the web and to agent apps, never to script or local files", () => {
    for (const url of ["https://claude.ai/chat/1", "http://localhost:3000/c/2", "cursor://anysphere.cursor-deeplink/chat", "slack://channel?id=C1", "VSCODE://file/x"]) {
      expect(isResumeUrl(url), url).toBe(true);
    }
    for (const url of ["javascript:alert(1)", " javascript:alert(1)", "vbscript:x", "data:text/html,x", "file:///etc/passwd", "blob:https://a/b", "/relative", ""]) {
      expect(isResumeUrl(url), url).toBe(false);
    }
    expect(isWebUrl("https://acme.slack.com/archives/C1/p2")).toBe(true);
    expect(isWebUrl("slack://channel?id=C1")).toBe(false);
    expect(isWebUrl("gmail:thread/18c1")).toBe(false);
  });

  it("keeps each agent's latest session first, up to the cap", () => {
    const first = withSession([], session("a"));
    const second = withSession(first, session("b"));
    expect(withSession(second, session("a", { sessionId: "a-2" })).map((entry) => entry.sessionId)).toEqual(["a-2", "b-1"]);

    const many = Array.from({ length: MAX_SESSIONS + 2 }, (_, index) => session(`agent-${index}`)).reduce(withSession, [] as AgentSession[]);
    expect(many).toHaveLength(MAX_SESSIONS);
    expect(many[0]?.agentId).toBe(`agent-${MAX_SESSIONS + 1}`);
  });

  it("treats a new link, id or command as moving, and a new brief or message as a refresh", () => {
    const before = session("a", { url: "https://x.test/c/1" });
    expect(movesSession(undefined, before)).toBe(true);
    expect(movesSession(before, { ...before, brief: "Later", messageId: "m2" })).toBe(false);
    expect(movesSession(before, { ...before, url: "https://x.test/c/2" })).toBe(true);
    expect(movesSession(before, { ...before, command: "claude --resume a-1" })).toBe(true);
  });

  it("names the app to resume in and finds the asking agent's session", () => {
    expect(resumeLabel({ app: "Claude Code" })).toBe("Resume in Claude Code");
    expect(resumeLabel({ app: null })).toBe("Resume conversation");
    const sessions = [session("a"), session("b")];
    expect(sessionOfAsker(sessions, { agentId: "b", agentName: "b", question: "?", askedAt: "" })?.agentId).toBe("b");
    expect(sessionOfAsker(sessions, { agentId: "c", agentName: "c", question: "?", askedAt: "" })).toBeUndefined();
  });
});
