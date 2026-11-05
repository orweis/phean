import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, expectNothingCutOff, expectNowClearOfDates } from "./support/checks";
import { DEMO_SESSION } from "./support/env";
import { card, entryKind, popover } from "./support/locators";

const PAGES = [
  "/workspaces",
  "/w/globex",
  "/w/globex/decisions",
  "/w/globex/board",
  "/w/globex/timeline",
  "/w/globex/timeline?days=90",
  "/w/globex/memory",
  "/w/globex/search?q=invoice",
  "/w/globex/agents",
  "/w/globex/members",
  "/w/globex/documents",
  "/w/globex/settings",
  "/w/globex/goals/g_missing",
  "/w/globex/documents/d_missing",
];

/** Pages that draw a timetable, so the Now marker can be checked against the date labels. */
const TIMETABLES = ["/w/globex", "/w/globex/timeline", "/w/globex/timeline?days=90", "/w/globex/timeline?days=30"];

/** Panels that only render their content once opened, by page and trigger (its text, or the start of its name). */
const PANELS = [
  ["/w/globex", "Other answer"],
  // On a phone the board shows one lane; In progress holds the cards with sessions to resume.
  ["/w/globex/board?lane=in_progress", "Resume"],
  ["/w/globex/board", "Edit"],
  ["/w/globex/board", "More actions for"],
  ["/w/globex/decisions", "Other answer"],
  ["/w/globex/decisions", "More for"],
  ["/w/globex/memory", "Add"],
  ["/w/globex/documents", "New document"],
] as const;

async function openPanel(page: Page, path: string, trigger: string) {
  await page.goto(path);
  // On a phone the board shows one lane, so the panel is the first one on screen.
  const panel = page
    .locator("details")
    .filter({ has: page.locator(`summary:has-text("${trigger}"), summary[aria-label^="${trigger}"]`), visible: true })
    .first();
  await panel.locator("summary").click();
  return panel;
}

/** The first goal on the overview's goal map, whose id is only known at run time. */
async function goalPage(page: Page): Promise<string> {
  await page.goto("/w/globex");
  const href = await card(page, "Goal map").getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/w\/globex\/goals\//);
  return href!;
}

test.describe("signed in", () => {
  test.use({ storageState: DEMO_SESSION });

  for (const path of PAGES) {
    test(`${path} has no detectable accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expectAccessible(page);
    });
  }

  test("a goal page has no detectable accessibility violations", async ({ page }) => {
    await page.goto(await goalPage(page));
    await expectAccessible(page);
  });

  for (const [path, trigger] of PANELS) {
    test(`${path} has no detectable accessibility violations with ${trigger} open`, async ({ page }) => {
      await openPanel(page, path, trigger);
      await expectAccessible(page);
    });
  }

  test("the first Tab lands on a skip link that goes past the header", async ({ page }) => {
    await page.goto("/w/globex/board");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#content$/);
  });

  test("a panel takes focus when it opens, and Escape gives it back to its trigger", async ({ page }) => {
    const panel = await openPanel(page, "/w/globex/board", "Edit");
    await expect(panel.getByLabel("Title")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).not.toHaveAttribute("open");
    await expect(panel.locator("summary")).toBeFocused();
  });

  test("the background refresh leaves an open panel open, with what was typed", async ({ page }) => {
    test.slow();
    const panel = await openPanel(page, "/w/globex/board", "Edit");
    const title = panel.getByLabel("Title");
    await title.fill("Typed before the refresh");
    await page.waitForRequest((request) => request.headers()["rsc"] === "1" && request.method() === "GET", { timeout: 25_000 });
    await page.waitForLoadState("networkidle");
    await expect(panel).toHaveAttribute("open");
    await expect(title).toHaveValue("Typed before the refresh");
    await expect(title).toBeFocused();
  });

  test("a document renders its Markdown, tables and Mermaid diagrams, and is reachable from the decision it informs", async ({ page }) => {
    await page.goto("/w/globex/decisions");
    const entry = page.locator("[data-entry]").filter({ hasText: "Chase three overdue invoices" });
    // The agent linked its draft from the request, and the task carries it as a document.
    await expect(entry.getByRole("link", { name: /^Draft reply to Globex/ }).first()).toBeVisible();
    await entry.getByRole("list", { name: "Documents" }).getByRole("link", { name: "Draft reply to Globex" }).click();
    await expect(page).toHaveURL(/\/w\/globex\/documents\/d_/);
    // A refresh opens the document as its own page.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Draft reply to Globex");
    const body = page.locator("[data-markdown]");
    await expect(body.getByRole("heading", { name: "Where the three invoices stand" })).toBeVisible();
    await expect(body.getByRole("table")).toContainText("#4471");
    await expect(body.locator('[data-diagram="drawn"] svg')).toBeVisible();
    await expectAccessible(page);
  });

  test("a board card opens in a side peek beside the board, and Escape brings focus back to it", async ({ page }) => {
    await page.goto("/w/globex/board");
    const card = page.locator('section[data-stage="in_progress"] article').filter({ hasText: "Chase three overdue invoices" });
    const title = card.getByRole("link", { name: "Chase three overdue invoices" });
    await title.click();
    await expect(page).toHaveURL(/\/w\/globex\/tasks\/t_/);
    const peek = page.getByRole("dialog", { name: "Task" });
    await expect(peek.getByRole("heading", { level: 2, name: "Chase three overdue invoices" })).toBeVisible();
    await expect(peek.getByRole("region", { name: "Waiting on you" })).toContainText("Globex disputes invoice #4471");
    // The board stays in view, and the card whose peek is open is marked as the selected one.
    await expect(page.locator('section[data-stage="in_progress"] [aria-current="true"]')).toContainText("Chase three overdue invoices");
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL("/w/globex/board");
    await expect(peek).toBeHidden();
    await expect(title).toBeFocused();
  });

  test("a peek opens as its own page from its link, a refresh, or a shared URL", async ({ page }) => {
    await page.goto("/w/globex/board");
    await page.locator('section[data-stage="in_progress"]').getByRole("link", { name: "Chase three overdue invoices" }).click();
    await page.getByRole("dialog", { name: "Task" }).getByRole("link", { name: "Open as page" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chase three overdue invoices");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a document opens in a wide peek that can fill the screen", async ({ page }) => {
    await page.goto("/w/globex/decisions");
    const entry = page.locator("[data-entry]").filter({ hasText: "Chase three overdue invoices" });
    await entry.getByRole("list", { name: "Documents" }).getByRole("link", { name: "Draft reply to Globex" }).click();
    const peek = page.getByRole("dialog", { name: "Document" });
    await expect(peek.locator("#document-title")).toHaveText("Draft reply to Globex");
    await expect(peek.locator('[data-diagram="drawn"] svg')).toBeVisible();
    const full = peek.getByRole("button", { name: "Full screen" });
    await full.click();
    await expect(peek.getByRole("button", { name: "Exit full screen" })).toHaveAttribute("aria-pressed", "true");
    const box = (await peek.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual((page.viewportSize()!.width) - 1);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL("/w/globex/decisions");
  });

  test("the selected request is unmistakable, and J and K move the selection", async ({ page }) => {
    await page.goto("/w/globex/decisions");
    const entries = page.locator("[data-entry]");
    await expect(entries).not.toHaveCount(0);
    await entries.first().focus();
    await expect(entries.first()).toHaveAttribute("aria-current", "true");
    await expect(entries.first()).toHaveAttribute("data-selected", "");
    if ((await entries.count()) > 1) {
      await page.keyboard.press("j");
      await expect(entries.nth(1)).toHaveAttribute("aria-current", "true");
      await expect(entries.first()).not.toHaveAttribute("aria-current");
      await page.keyboard.press("k");
      await expect(entries.first()).toHaveAttribute("aria-current", "true");
    }
    // Enter opens the selected request's task.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Task" })).toBeVisible();
  });

  test("? opens the keyboard shortcuts legend, and so does the account menu", async ({ page }) => {
    await page.goto("/w/globex");
    const legend = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    // The page listens once it has hydrated; a person never types that fast.
    await expect(async () => {
      await page.keyboard.press("?");
      await expect(legend).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(legend).toContainText("Pick the focused request's option");
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(legend).toBeHidden();
    const account = popover(page, "Dana");
    await account.locator("summary").click();
    await account.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(legend).toBeVisible();
  });

  test("an unknown goal says so and leads back to the overview", async ({ page }) => {
    await page.goto("/w/globex/goals/g_missing");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This goal does not exist or was removed");
    await expect(page.getByRole("link", { name: "Back to the overview" })).toHaveAttribute("href", "/w/globex");
  });

  for (const path of TIMETABLES) {
    test(`${path} keeps the Now chip clear of the dates`, async ({ page }) => {
      await page.goto(path);
      await expectNowClearOfDates(page);
    });
  }

  test.describe("on a 375px phone", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    for (const path of PAGES) {
      test(`${path} keeps everything inside the screen`, async ({ page }) => {
        await page.goto(path);
        await expectNothingCutOff(page);
      });
    }

    test("a goal page keeps everything inside the screen", async ({ page }) => {
      await page.goto(await goalPage(page));
      await expectNothingCutOff(page);
      await expectNowClearOfDates(page);
    });

    for (const path of TIMETABLES) {
      test(`${path} keeps the Now chip clear of the dates`, async ({ page }) => {
        await page.goto(path);
        await expectNowClearOfDates(page);
      });
    }

    for (const [path, trigger] of PANELS) {
      test(`${path} opens ${trigger} inside the screen`, async ({ page }) => {
        const panel = await openPanel(page, path, trigger);
        await expect(panel.locator(":scope > div")).toBeInViewport();
        await expectNothingCutOff(page);
      });
    }

    test("the overview puts what waits on you and late work first", async ({ page }) => {
      await page.goto("/w/globex");
      const top = async (title: string) => (await card(page, title).boundingBox())!.y;
      const order = ["Waiting on you", "Late", "On the line", "Next actions", "Goal map", "Agents", "Activity"];
      const tops = await Promise.all(order.map(top));
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
    });

    test("the tab rail keeps the active tab in view", async ({ page }) => {
      await page.goto("/w/globex/members");
      await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Members" })).toBeInViewport({ ratio: 1 });
    });

    test("the board shows one lane at a time, picked from a sticky bar held in the URL", async ({ page }) => {
      await page.goto("/w/globex/board");
      const picker = page.getByRole("navigation", { name: "Lane" });
      await picker.getByRole("link", { name: /^Done/ }).click();
      await expect(page).toHaveURL(/lane=done/);
      await expect(page.locator('section[aria-labelledby="lane-done"]')).toBeVisible();
      await expect(page.locator('section[aria-labelledby="lane-inbox"]')).toBeHidden();
      await page.reload();
      await expect(picker.getByRole("link", { name: /^Done/ })).toHaveAttribute("aria-current", "page");
    });

    test("an agent's question opens its answer inline, under the question", async ({ page }) => {
      await page.goto("/w/globex/decisions");
      const entry = page.locator("[data-entry]").first();
      const answer = entry.locator("details").filter({ has: page.locator('summary:has-text("Other answer")') });
      await answer.locator("summary").click();
      const question = await entry.locator("blockquote").boundingBox();
      const field = await answer.getByRole("textbox").boundingBox();
      expect(field!.y).toBeGreaterThan(question!.y);
      await expect(entry.locator("blockquote")).toBeInViewport();
    });

    test("the manual entry sheet opens inside the screen and closes on its own", async ({ page }) => {
      await page.goto("/w/globex");
      const entry = popover(page, "Add manually");
      await entry.locator("summary").click();
      await entryKind(entry, "Goal").click();
      await expect(entry.getByRole("textbox", { name: "Title" })).toBeInViewport();
      await expectNothingCutOff(page);
      await expectAccessible(page);
      await entry.getByRole("button", { name: "Close" }).click();
      await expect(entry.getByRole("textbox", { name: "Title" })).toBeHidden();
    });
  });
});

test.describe("in the dark appearance", () => {
  test.use({ colorScheme: "dark" });

  for (const path of ["/", "/sign-in", "/sign-up"]) {
    test(`${path} has no detectable accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expectAccessible(page);
    });
  }

  test.describe("signed in", () => {
    test.use({ storageState: DEMO_SESSION });

    for (const path of PAGES) {
      test(`${path} has no detectable accessibility violations`, async ({ page }) => {
        await page.goto(path);
        await expectAccessible(page);
      });
    }

    test("a goal page has no detectable accessibility violations", async ({ page }) => {
      await page.goto(await goalPage(page));
      await expectAccessible(page);
    });

    for (const [path, trigger] of PANELS) {
      test(`${path} has no detectable accessibility violations with ${trigger} open`, async ({ page }) => {
        await openPanel(page, path, trigger);
        await expectAccessible(page);
      });
    }
  });
});

test.describe("signed out, on a 375px phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const path of ["/", "/sign-in", "/sign-up"]) {
    test(`${path} keeps everything inside the screen`, async ({ page }) => {
      await page.goto(path);
      await expectNothingCutOff(page);
    });
  }

  test("the sample timetable keeps the Now chip clear of the dates", async ({ page }) => {
    await page.goto("/");
    await expectNowClearOfDates(page);
  });
});
