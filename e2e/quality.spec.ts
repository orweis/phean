import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, expectNothingCutOff } from "./support/checks";
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
});
