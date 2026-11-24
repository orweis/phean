import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  barFractions,
  change,
  clientFamily,
  describeChange,
  distinctByWindow,
  formatBytes,
  funnel,
  healthFlags,
  median,
  retentionGrid,
  retentionStep,
  sumByWindow,
  toCsv,
  trailingWindows,
  twoFactorRequired,
  windowIndexOf,
  windowLabel,
  type FunnelPerson,
} from "@/lib/backoffice";
import { isoDate } from "@/lib/dates";
import { routes } from "@/lib/routes";
import { ADMIN_PAGES, adminPaths } from "@/server/backoffice/paths";

const DAY = 86_400_000;

describe("trailing windows", () => {
  it("lays whole weeks back to back, the last ending today", () => {
    const windows = trailingWindows("2026-11-24", 3);
    expect(windows).toEqual([
      { from: "2026-11-04", to: "2026-11-10" },
      { from: "2026-11-11", to: "2026-11-17" },
      { from: "2026-11-18", to: "2026-11-24" },
    ]);
    expect(windowIndexOf("2026-11-11", windows)).toBe(1);
    expect(windowIndexOf("2026-11-03", windows)).toBe(-1);
    expect(windowLabel(windows[2]!)).toBe("18–24 Nov");
    expect(windowLabel({ from: "2026-10-28", to: "2026-11-03" })).toBe("28 Oct–3 Nov");
  });

  it("sums values and counts distinct keys per window", () => {
    const windows = trailingWindows("2026-11-24", 2);
    expect(sumByWindow([{ day: "2026-11-24", value: 2 }, { day: "2026-11-18", value: 1 }, { day: "2026-11-12", value: 5 }, { day: "2026-01-01", value: 9 }], windows)).toEqual([5, 3]);
    expect(
      distinctByWindow(
        [
          { day: "2026-11-24", key: "a" },
          { day: "2026-11-23", key: "a" },
          { day: "2026-11-20", key: "b" },
          { day: "2026-11-12", key: "a" },
        ],
        windows,
      ),
    ).toEqual([1, 2]);
  });
});

describe("figures", () => {
  it("takes medians, changes and bar heights", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(change(12, 10)).toBeCloseTo(0.2);
    expect(change(3, 0)).toBeNull();
    expect(describeChange(12, 10)).toEqual({ text: "+20% on the 7 days before", tone: "success" });
    expect(describeChange(5, 10)).toEqual({ text: "−50% on the 7 days before", tone: "warning" });
    expect(describeChange(10, 10).text).toBe("No change on the 7 days before");
    expect(describeChange(4, 0).text).toBe("None the 7 days before");
    expect(describeChange(0, 0).text).toBe("None either week");
    expect(barFractions([0, 5, 10])).toEqual([0, 0.5, 1]);
    expect(barFractions([0, 0])).toEqual([0, 0]);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });
});

describe("activation funnel", () => {
  const now = Date.UTC(2026, 10, 24);
  const today = isoDate(new Date(now));
  const person = (overrides: Partial<FunnelPerson>): FunnelPerson => {
    const signedUpAt = overrides.signedUpAt ?? now - 40 * DAY;
    return { signedUpAt, signupDay: isoDate(new Date(signedUpAt)), workspaceAt: null, agentAt: null, askedAt: null, answeredAt: null, activeDays: [], ...overrides };
  };

  it("counts each step among those who reached the one before, with median times", () => {
    const start = now - 40 * DAY;
    const people = [
      person({ workspaceAt: start + 1_000, agentAt: start + 3_000, askedAt: start + DAY, answeredAt: start + 2 * DAY, activeDays: [0, 8, 22] }),
      person({ workspaceAt: start + 3_000, agentAt: start + 7_000, askedAt: start + 3 * DAY, activeDays: [0, 9] }),
      person({ workspaceAt: start + 5_000 }),
      // Answered without asking in a workspace they own: not counted past the step they missed.
      person({ answeredAt: start + DAY }),
    ];
    const steps = funnel(people, today);
    expect(steps.map((step) => step.count)).toEqual([4, 3, 2, 2, 1, 1, 1]);
    expect(steps[1]).toMatchObject({ fromPrevious: 0.75, fromStart: 0.75, medianFromPrevious: 3_000, medianOver: 3 });
    expect(steps[2]!.medianFromPrevious).toBe(3_000);
    expect(steps[4]).toMatchObject({ fromPrevious: 0.5, fromStart: 0.25, medianFromPrevious: DAY });
    expect(steps[5]).toMatchObject({ key: "week2", eligible: 4, fromPrevious: 1 });
    expect(steps[6]).toMatchObject({ key: "week4", count: 1, medianFromPrevious: null });
  });

  it("leaves people out of a week that has not ended for them", () => {
    const recent = person({ signedUpAt: now - 10 * DAY, workspaceAt: now - 10 * DAY, agentAt: now - 10 * DAY, askedAt: now - 9 * DAY, answeredAt: now - 9 * DAY, activeDays: [8] });
    const steps = funnel([recent], today);
    expect(steps[5]).toMatchObject({ eligible: 0, count: 0, fromStart: 0 });
  });

  it("counts a week as over by UTC days, even a few minutes after midnight", () => {
    // Signed up at 23:59 on the 10th; by 00:30 on the 24th, days 7 to 13 (the 17th to the 23rd) are over,
    // though fewer than 14 times 24 hours have passed.
    const signedUpAt = Date.UTC(2026, 10, 10, 23, 59);
    const early = Date.UTC(2026, 10, 24, 0, 30);
    const late = person({ signedUpAt, workspaceAt: signedUpAt, agentAt: signedUpAt, askedAt: signedUpAt, answeredAt: signedUpAt, activeDays: [9] });
    expect(funnel([late], isoDate(new Date(early)))[5]).toMatchObject({ key: "week2", eligible: 1, count: 1 });
    expect(funnel([late], "2026-11-23")[5]).toMatchObject({ key: "week2", eligible: 0 });
  });
});

describe("retention grid", () => {
  it("fills only the weeks that are over for the whole cohort", () => {
    const windows = trailingWindows("2026-11-24", 3);
    const grid = retentionGrid(
      [
        { signupDay: "2026-11-04", activeDays: ["2026-11-04", "2026-11-12"] },
        { signupDay: "2026-11-10", activeDays: ["2026-11-10"] },
        { signupDay: "2026-11-18", activeDays: ["2026-11-18"] },
      ],
      windows,
      "2026-11-24",
    );
    expect(grid[0]).toMatchObject({ size: 2 });
    // Week 0 is over for both; week 1 (days 7–13) is over for a signup on the 10th by the 23rd.
    expect(grid[0]!.cells.slice(0, 3)).toEqual([1, 0.5, null]);
    expect(grid[2]!.cells).toEqual([null, null, null]);
    expect(retentionStep(0)).toBe(0);
    expect(retentionStep(0.1)).toBe(1);
    expect(retentionStep(0.5)).toBe(2);
    expect(retentionStep(1)).toBe(4);
  });
});

describe("health flags", () => {
  const now = Date.UTC(2026, 10, 24);
  it("marks dormant, stuck and failing workspaces", () => {
    const quiet = { createdAt: now - 30 * DAY, lastActivityAt: now - 20 * DAY, oldestOpenRequestAt: null, webhooksDisabled: 0, maxWebhookFailures: 0 };
    expect(healthFlags(quiet, now)).toEqual(["dormant"]);
    expect(healthFlags({ ...quiet, createdAt: now - DAY, lastActivityAt: null }, now)).toEqual([]);
    expect(healthFlags({ ...quiet, lastActivityAt: now, oldestOpenRequestAt: now - 4 * DAY, maxWebhookFailures: 3 }, now)).toEqual(["stuck_decisions", "failing_webhooks"]);
    expect(healthFlags({ ...quiet, lastActivityAt: now, webhooksDisabled: 1 }, now)).toEqual(["failing_webhooks"]);
  });
});

describe("clients, CSV and settings", () => {
  it("names an agent's client family", () => {
    const oauth = (clientName: string | null) => ({ authKind: "oauth", clientName, sharesParentKey: false });
    expect(clientFamily(oauth("Claude Code"))).toBe("Claude Code");
    expect(clientFamily(oauth("claude-code/2.1"))).toBe("Claude Code");
    expect(clientFamily(oauth("Claude"))).toBe("Claude");
    expect(clientFamily(oauth("Cursor"))).toBe("Cursor");
    expect(clientFamily(oauth("Visual Studio Code"))).toBe("VS Code");
    expect(clientFamily(oauth("Some bot"))).toBe("Other OAuth client");
    expect(clientFamily(oauth(null))).toBe("Other OAuth client");
    expect(clientFamily({ authKind: "key", clientName: null, sharesParentKey: false })).toBe("Fixed key");
    expect(clientFamily({ authKind: "key", clientName: null, sharesParentKey: true })).toBe("Shared key");
  });

  it("writes CSV that a spreadsheet will not run", () => {
    expect(toCsv([["Name", "Count"], ["Acme, Inc.", 3], ['Say "hi"', null], ["=HYPERLINK(\"x\")", -1], ["@cmd", "+1"]])).toBe(
      'Name,Count\r\n"Acme, Inc.",3\r\n"Say ""hi""",\r\n"\'=HYPERLINK(""x"")",-1\r\n\'@cmd,\'+1\r\n',
    );
  });

  it("asks admins for two-factor everywhere, letting only a machine off Vercel turn it off", () => {
    expect(twoFactorRequired(undefined, "production")).toBe(true);
    expect(twoFactorRequired(undefined, "preview")).toBe(true);
    expect(twoFactorRequired("0", "preview")).toBe(true);
    expect(twoFactorRequired("0", "production")).toBe(true);
    expect(twoFactorRequired(undefined, undefined)).toBe(true);
    expect(twoFactorRequired("maybe", undefined)).toBe(true);
    expect(twoFactorRequired("0", undefined)).toBe(false);
    expect(twoFactorRequired("false", "")).toBe(false);
  });

  it("lists the tabs under /admin", () => {
    expect(ADMIN_PAGES.map((page) => page.href)).toEqual(["/admin", "/admin/activation", "/admin/workspaces", "/admin/people", "/admin/agents", "/admin/usage", "/admin/health", "/admin/audit"]);
    expect(adminPaths.workspaces({ q: "acme", sort: "name", page: undefined })).toBe("/admin/workspaces?q=acme&sort=name");
    expect(adminPaths.audit(1)).toBe("/admin/audit");
    // The client bundles' route table and the service worker never name the console.
    expect(JSON.stringify(Object.keys(routes))).not.toMatch(/admin/i);
    expect(readFileSync("public/sw.js", "utf8")).not.toContain("/admin");
  });
});
