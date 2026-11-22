import { expect, test } from "@playwright/test";

import { DEMO_SESSION } from "./support/env";

/** Reads the seeded Globex workspace. Never writes. */
test.use({ storageState: DEMO_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const clipboard = (page: import("@playwright/test").Page) => page.evaluate(() => navigator.clipboard.readText());

/**
 * Agents and people share links to one thing in Phean: a permalink by id lands on its page, and a
 * copied link to a decision or a memory opens the page with that one brought into view.
 */
test("a permalink by id opens the task it names", async ({ page }) => {
  await page.goto("/w/globex/board");
  const href = (await page.locator("a[data-task-link]").first().getAttribute("href"))!;
  const taskId = href.split("/").at(-1)!;
  await page.goto(`/w/globex/link/${taskId}`);
  await expect(page).toHaveURL(`/w/globex/tasks/${taskId}`);
  await page.getByRole("button", { name: "Copy link to this task" }).click();
  expect(await clipboard(page)).toMatch(new RegExp(`/w/globex/tasks/${taskId}$`));
});

test("a copied link to a decision lands on that request on the Decisions page", async ({ page }) => {
  await page.goto("/w/globex/decisions");
  const entry = page.locator("[data-entry]").nth(1);
  const title = (await entry.getAttribute("aria-label"))!;
  await entry.getByRole("button", { name: `Copy link to the request on ${title}` }).click();
  const link = await clipboard(page);
  expect(link).toMatch(/\/w\/globex\/decisions\?focus=q_/);

  await page.goto(link);
  const focused = page.locator("[data-focused]");
  await expect(focused).toHaveAttribute("aria-label", title);
  await expect(focused).toBeFocused();
  await expect(focused).toBeInViewport();
});

test("a copied link to a memory brings it into view", async ({ page }) => {
  await page.goto("/w/globex/memory");
  const item = page.locator("li").filter({ has: page.getByRole("button", { name: /^Copy link to “/ }) }).first();
  await item.hover();
  await item.getByRole("button", { name: /^Copy link to “/ }).click();
  const link = await clipboard(page);
  expect(link).toMatch(/\/w\/globex\/memory\?focus=m_/);
  await page.goto(link);
  await expect(page.locator("[data-focused]")).toBeFocused();
});

test("a link to something that is not there says so", async ({ page }) => {
  await page.goto("/w/globex/decisions?focus=q_missing0");
  await expect(page.getByRole("status").filter({ hasText: "not in this workspace" })).toBeVisible();
  const response = await page.request.get("/w/globex/link/not-an-id", { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});

/** `/w` is the way into the app: the workspace last opened, or the list when there is none to return to. */
test("/w opens the workspace last opened, or the list of workspaces", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Open Phean" }).first()).toHaveAttribute("href", "/w");

  await page.goto("/w/globex/board");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/w");
  await expect(page).toHaveURL("/w/globex");

  // A link to another workspace that only came into view is not a visit.
  await page.goto("/workspaces");
  await page.goto("/w");
  await expect(page).toHaveURL("/w/globex");

  // Leave the workspace first, so its page cannot remember it again.
  await page.goto("/account");
  // A workspace this person cannot see is never opened for them.
  await context.addCookies([{ name: "phean-workspace", value: "not-theirs", domain: "localhost", path: "/" }]);
  await page.goto("/w");
  await expect(page).toHaveURL("/workspaces");

  await context.clearCookies({ name: "phean-workspace" });
  await page.goto("/w");
  await expect(page).toHaveURL("/workspaces");
});
