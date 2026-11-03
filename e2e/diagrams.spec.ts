import { expect, test, type Page } from "@playwright/test";

import { DEMO_SESSION } from "./support/env";
import { card, lane } from "./support/locators";

/** Reads the seeded Globex workspace, which has three weeks of backdated history. Never writes. */
test.use({ storageState: DEMO_SESSION });

const track = (page: Page, title: string) => page.locator("li[data-task]").filter({ hasText: title });

test("the overview leads with status, the line and the goal map", async ({ page }) => {
  await page.goto("/w/globex");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Globex");

  const today = page.getByRole("region", { name: "Today on the line" });
  await expect(today.getByRole("img", { name: /^Open work by status: \d+ inbox/ })).toBeVisible();

  const line = card(page, "On the line");
  await expect(line).toContainText(/The 8 most pressing of \d+ open tasks/);
  await expect(line.locator("li[data-task]")).toHaveCount(8);
  await expect(line.locator("[data-now]")).toContainText("Now");
  const onLine = (title: string) => line.locator("li[data-task]").filter({ hasText: title });
  await expect(onLine("Chase three overdue invoices")).toContainText(/Late, due/);
  await expect(onLine("Renew the SSL certificate")).toBeVisible();
  await expect(onLine("Read the Slack thread about on-call pay")).toHaveCount(0);
  await expect(line.locator('[data-end="arrived"], [data-end="dropped"]')).toHaveCount(0);

  await expect(card(page, "Next actions")).toContainText("Chase three overdue invoices");

  const map = card(page, "Goal map");
  await expect(map.getByRole("link", { name: "Launch the partner portal" })).toBeVisible();
  await expect(map.getByRole("link", { name: "Billing integration" })).toBeVisible();
  await expect(map.getByRole("link", { name: "Renew the office lease" })).toHaveCount(0);
  await expect(map.getByRole("img", { name: "Migrate the CRM tasks by status: 3 done" })).toBeVisible();

  await expect(card(page, "1 goal awaiting your decision")).toContainText("Renew the office lease");
  await expect(card(page, "Late")).toContainText("Chase three overdue invoices");
  for (const agent of ["Inbox sweeper", "Calendar planner", "Finance clerk"]) await expect(card(page, "Agents")).toContainText(agent);
});

test("the timeline charts how the work moved, with the numbers on request", async ({ page }) => {
  await page.goto("/w/globex/timeline");
  const flow = card(page, "How the work moved");
  await expect(flow.locator("figure svg path")).toHaveCount(4);
  const numbers = flow.getByRole("table", { name: "Tasks at each status at the end of each day" });
  await expect(numbers).toBeHidden();
  await flow.getByText("Show the numbers").click();
  await expect(numbers).toBeVisible();
  await expect(numbers.locator("tbody tr")).toHaveCount(14);
});

test("a window longer than the history starts with the history", async ({ page }) => {
  await page.goto("/w/globex/timeline?days=90");
  await expect(page.getByText(/Where every task stood each day since \w+ \d+\./)).toBeVisible();
  await expect(track(page, "Set up the partner Slack channel").locator('[data-end="arrived"]')).toHaveCount(1);
});

test("the timetable draws a track per task with its stations and ends", async ({ page }) => {
  await page.goto("/w/globex/timeline");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Timeline");
  await expect(card(page, "Timetable").locator("[data-now]")).toContainText("Now");

  const books = page.getByRole("region", { name: "Close the Q4 books" });
  await expect(books.locator("li[data-task]").first()).toBeVisible();
  await expect(track(page, "Chase three overdue invoices")).toContainText(/Late, due/);
  await expect(track(page, "Chase three overdue invoices").locator('[data-end="open"] [data-segment="in_progress"]')).not.toHaveCount(0);
  await expect(track(page, "Write the partner API quickstart").locator('[data-end="arrived"]')).toHaveCount(1);
  await expect(track(page, "Prepare the take-home exercise").locator('[data-end="dropped"]')).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Not filed under a goal" })).toContainText("Renew the SSL certificate");

  // Work finished before the window opened only appears once the window reaches back to it.
  await expect(track(page, "Set up the partner Slack channel")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Time window" }).getByRole("link", { name: "30 days" }).click();
  await expect(page).toHaveURL(/days=30/);
  await expect(track(page, "Set up the partner Slack channel").locator('[data-end="arrived"]')).toHaveCount(1);
});

test("hovering a track brings it forward and dims the rest", async ({ page }) => {
  await page.goto("/w/globex/timeline");
  const focused = track(page, "Chase three overdue invoices");
  const other = track(page, "Accrue December payroll");
  const opacity = (row: typeof focused) => row.evaluate((element) => Number(getComputedStyle(element).opacity));

  await expect.poll(() => opacity(other)).toBe(1);
  await focused.hover();
  await expect.poll(() => opacity(other)).toBeLessThan(0.5);
  await expect.poll(() => opacity(focused)).toBe(1);
});

test("the timeline narrows to one goal", async ({ page }) => {
  await page.goto("/w/globex/timeline");
  await page.getByLabel("Filter by goal").selectOption({ label: "Hire a support lead" });
  await expect(page).toHaveURL(/goal=/);
  await expect(page.getByRole("region", { name: "Hire a support lead" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Close the Q4 books" })).toHaveCount(0);
});

test("a goal page rolls up its sub-goals and draws its own timetable", async ({ page }) => {
  await page.goto("/w/globex");
  await card(page, "Goal map").getByRole("link", { name: "Launch the partner portal" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Launch the partner portal");

  await expect(page.getByRole("img", { name: /^Tasks by status:.*done/ })).toBeVisible();
  const subGoals = card(page, "Sub-goals");
  await expect(subGoals.getByRole("link", { name: "Partner onboarding docs" })).toBeVisible();
  await expect(subGoals.getByRole("link", { name: "Billing integration" })).toBeVisible();
  await expect(card(page, "Timetable").locator("li[data-task]")).not.toHaveCount(0);
});

test("the board lanes follow the stations in order", async ({ page }) => {
  await page.goto("/w/globex/board");
  const lanes = page.locator("section[aria-labelledby^=lane-] h2");
  await expect(lanes).toHaveText(["Inbox", "To do", "In progress", "Done"]);
  await expect(lane(page, "in_progress")).toContainText("Chase three overdue invoices");

  const done = lane(page, "done").locator("article[data-task]");
  await expect(done.filter({ visible: true })).toHaveCount(5);
  await lane(page, "done").getByText(/^Show \d+ more$/).click();
  await expect(done.filter({ visible: true })).toHaveCount(await done.count());
  await expect(lane(page, "done").getByText("Show fewer")).toBeVisible();
});

test("the workspaces table shows open work per workspace", async ({ page }) => {
  await page.goto("/workspaces");
  for (const name of ["Acme Corp", "Globex"]) {
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByRole("img", { name: new RegExp(`^${name} open work: `) })).toBeVisible();
  }
});
