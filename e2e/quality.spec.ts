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
  "/w/globex/goals/g_missing",
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
