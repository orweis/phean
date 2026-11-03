import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, expectNothingCutOff, expectNowClearOfDates } from "./support/checks";
import { DEMO_SESSION } from "./support/env";
import { card } from "./support/locators";

const PAGES = [
  "/workspaces",
  "/w/globex",
  "/w/globex/board",
  "/w/globex/timeline",
  "/w/globex/timeline?days=90",
  "/w/globex/memory",
  "/w/globex/search?q=invoice",
  "/w/globex/agents",
  "/w/globex/members",
];

/** Pages that draw a timetable, so the Now marker can be checked against the date labels. */
const TIMETABLES = ["/w/globex", "/w/globex/timeline", "/w/globex/timeline?days=90", "/w/globex/timeline?days=30"];

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

    test("the overview puts decisions and late work first", async ({ page }) => {
      await page.goto("/w/globex");
      const top = async (title: string) => (await card(page, title).boundingBox())!.y;
      const order = ["1 goal awaiting your decision", "Late", "On the line", "Next actions", "Goal map", "Agents", "Activity"];
      const tops = await Promise.all(order.map(top));
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
    });

    test("the new goal panel opens inside the screen", async ({ page }) => {
      await page.goto("/w/globex");
      await page.locator("summary").filter({ hasText: "New goal" }).first().click();
      await expect(page.getByLabel("Title")).toBeInViewport();
      await expectNothingCutOff(page);
    });
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
