import { expect, test, type Page } from "@playwright/test";

import { DEMO_SESSION } from "./support/env";
import { card, lane } from "./support/locators";
import { openTab } from "./support/navigation";

/** Reads the seeded Globex workspace, which has three weeks of backdated history. Never writes. */
test.use({ storageState: DEMO_SESSION });

const track = (page: Page, title: string) => page.locator("li[data-task]").filter({ hasText: title });

test("the overview leads with status, the line and the goal map", async ({ page }) => {
  await page.goto("/w/globex");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Globex");

  const today = page.getByRole("region", { name: "Today on the line" });
  // Each status in the strip opens its tasks as a table.
  const statuses = today.getByRole("list", { name: "Open work by status" });
  await expect(statuses.getByRole("link", { name: /^Inbox \d+\W+open them as a table$/ })).toBeVisible();

  const line = card(page, "On the line");
  await expect(line).toContainText(/The 8 most pressing of \d+ open tasks/);
  await expect(line.locator("li[data-task]")).toHaveCount(8);
  await expect(line.locator("[data-now]")).toContainText("Now");
  const onLine = (title: string) => line.locator("li[data-task]").filter({ hasText: title });
  await expect(onLine("Chase three overdue invoices")).toContainText(/Late, due/);
  await expect(onLine("Renew the SSL certificate")).toBeVisible();
  await expect(onLine("Read the Slack thread about on-call pay")).toHaveCount(0);
  await expect(line.locator('[data-end="arrived"], [data-end="dropped"]')).toHaveCount(0);

  // A task with an open question is answered in the card above, so its controls show only there.
  await expect(card(page, "Next actions").locator("li[data-task]")).not.toHaveCount(0);
  await expect(card(page, "Next actions")).not.toContainText("Chase three overdue invoices");
  // Each track's title leads to its goal.
  await expect(onLine("Chase three overdue invoices").getByRole("link", { name: "Chase three overdue invoices" })).toHaveAttribute("href", /\/w\/globex\/goals\//);

  const map = card(page, "Goal map");
  await expect(map.getByRole("link", { name: "Launch the partner portal" })).toBeVisible();
  await expect(map.getByRole("link", { name: "Billing integration" })).toBeVisible();
  await expect(map.getByRole("link", { name: "Renew the office lease" })).toHaveCount(0);
  await expect(map.getByRole("img", { name: "Migrate the CRM tasks by status: 3 done" })).toBeVisible();

  const waiting = card(page, "Waiting on you");
  await expect(waiting).toContainText("2 agent questions and 1 goal to approve.");
  await expect(waiting.locator("#approvals")).toContainText("Renew the office lease");
  // Late work already waiting on a person collapses to one line that points at its entry.
  const late = card(page, "Late").locator("li[data-task]").filter({ hasText: "Chase three overdue invoices" });
  await expect(late.getByRole("link", { name: /^Also waiting on your/ })).toHaveAttribute("href", /^#task-/);
  await expect(late.getByRole("button")).toHaveCount(0);
  for (const agent of ["Inbox sweeper", "Calendar planner", "Finance clerk"]) await expect(card(page, "Agents")).toContainText(agent);
});

test("the timeline charts how the work moved, with the numbers on request", async ({ page }) => {
  await page.goto("/w/globex/timeline");
  const flow = card(page, "How the work moved");
  await expect(flow.locator("figure svg path")).toHaveCount(5);
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

  await expect(page.getByRole("list", { name: "Tasks by status" }).getByRole("link", { name: /^Done \d+/ })).toBeVisible();
  const subGoals = card(page, "Sub-goals");
  await expect(subGoals.getByRole("link", { name: "Partner onboarding docs" })).toBeVisible();
  await expect(subGoals.getByRole("link", { name: "Billing integration" })).toBeVisible();
  await expect(card(page, "Timetable").locator("li[data-task]")).not.toHaveCount(0);
});

test("the goals page lists every open goal, and peeks into a goal's tasks", async ({ page }) => {
  await page.goto("/w/globex");
  await openTab(page, "globex", "Goals");
  const goal = (title: string) => page.locator("li[data-goal]").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await expect(goal("Launch the partner portal")).toBeVisible();
  await expect(goal("Renew the office lease")).toContainText("Proposed");
  await expect(goal("Migrate the CRM")).toHaveCount(0);
  await expect(goal("Close the Q4 books")).toContainText(/\d+ late/);

  await goal("Close the Q4 books").getByRole("button", { name: /open tasks? in Close the Q4 books$/ }).click();
  const peek = page.getByRole("list", { name: "Open tasks in Close the Q4 books" });
  await expect(peek.locator("li[data-task]").first()).toContainText("Chase three overdue invoices");
  await expect(peek).not.toContainText("Reconcile November card spend");
  await expect(goal("Close the Q4 books")).toContainText("3 done tasks");

  // A task opens in the side peek, over the goals it was opened from.
  await peek.getByRole("link", { name: "Accrue December payroll" }).click();
  await expect(page.getByRole("dialog", { name: "Task" }).getByRole("heading", { name: "Accrue December payroll" })).toBeVisible();

  await page.goto("/w/globex/goals");
  await page.getByRole("navigation", { name: "Show goals" }).getByRole("link", { name: "Achieved" }).click();
  await expect(page).toHaveURL("/w/globex/goals?show=achieved");
  await expect(goal("Migrate the CRM")).toBeVisible();
  await expect(goal("Launch the partner portal")).toHaveCount(0);
});

test("a status in the overview's strip opens its tasks, which switch between board, table, calendar and map", async ({ page }) => {
  await page.goto("/w/globex");
  await page.getByRole("region", { name: "Today on the line" }).getByRole("link", { name: /^In progress \d+/ }).click();
  await expect(page).toHaveURL("/w/globex/board?view=table&status=in_progress");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  const layouts = page.getByRole("navigation", { name: "Task layout" });
  await expect(layouts.getByRole("link", { name: "Table" })).toHaveAttribute("aria-current", "page");
  const table = page.getByRole("table", { name: /^Tasks, sorted by due/ });
  await expect(table.locator("tbody tr")).not.toHaveCount(0);
  await expect(table.locator("tbody")).toContainText("In progress");
  await expect(table.locator("tbody")).not.toContainText("To do");

  // A column heading sorts by it; urgent work leads by priority.
  await table.getByRole("link", { name: "Priority" }).click();
  await expect(page).toHaveURL(/sort=priority&dir=asc/);
  await expect(page.getByRole("columnheader", { name: "Priority" })).toHaveAttribute("aria-sort", "ascending");
  const urgent = page.locator("tbody tr").first();
  await expect(urgent).toContainText("Chase three overdue invoices");
  // What waits on a person stays marked in every layout, as on the board.
  await expect(urgent.getByRole("link", { name: "Decision for you" })).toBeVisible();
  // The row whose task is open in the side peek is marked as the selected one.
  await urgent.getByRole("link", { name: "Chase three overdue invoices" }).click();
  await expect(page.getByRole("dialog", { name: "Task" })).toBeVisible();
  await expect(urgent.getByRole("link", { name: "Chase three overdue invoices" })).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Escape");

  // The status filter carries to the other layouts; the sort stays with the table.
  await layouts.getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL("/w/globex/board?status=in_progress&view=calendar");
  const calendar = page.getByRole("table", { name: /^Tasks due in / });
  await expect(calendar.locator('[aria-current="date"]')).toHaveCount(1);
  // Each task names its status in words, not only by its dot's colour.
  await expect(calendar.getByText("In progress:").first()).toBeAttached();
  const month = await page.getByRole("heading", { level: 2 }).first().textContent();
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page.getByRole("heading", { level: 2 }).first()).not.toHaveText(month!);

  await layouts.getByRole("link", { name: "Map" }).click();
  await expect(page).toHaveURL("/w/globex/board?status=in_progress&view=map");
  const map = page.getByRole("region", { name: "Map of goals and tasks" });
  await expect(map.getByRole("link", { name: "Close the Q4 books" })).toBeVisible();
  await expect(map.getByRole("link", { name: /^In progress: Chase three overdue invoices.*Decision for you.*Late$/ })).toBeVisible();
  await map.getByRole("link", { name: "Chase three overdue invoices" }).click();
  await expect(page.getByRole("dialog", { name: "Task" }).getByRole("heading", { name: "Chase three overdue invoices" })).toBeVisible();
});

test("search in the header suggests places, filters and matches as you type, by keyboard or mouse", async ({ page }) => {
  await page.goto("/w/globex/goals");
  // `/` focuses the header's search on a page without a search box of its own.
  const box = page.getByRole("combobox", { name: "Search the workspace" });
  // The shortcut listens once the page has hydrated, so press until it does.
  await expect(async () => {
    await page.keyboard.press("/");
    await expect(box).toBeFocused({ timeout: 500 });
  }).toPass();

  await box.fill("invoice");
  const list = page.getByRole("listbox", { name: /^Suggestions for / });
  const match = list.getByRole("group", { name: "Tasks" }).getByRole("option", { name: /^Chase three overdue invoices/ });
  await expect(match).toBeVisible();
  await expect(list.getByRole("option", { name: "Search for “invoice”" })).toBeVisible();
  await expect(box).toHaveAttribute("aria-expanded", "true");

  // Escape closes the list and keeps the words; the mouse opens a match in the side peek.
  await box.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(box).toHaveValue("invoice");
  await box.press("ArrowDown");
  await match.click();
  await expect(page.getByRole("dialog", { name: "Task" }).getByRole("heading", { name: "Chase three overdue invoices" })).toBeVisible();

  // Another word for a page finds it; arrow keys and Enter go there.
  await page.goto("/w/globex");
  await box.fill("kanban");
  // A page found by another word for it says which.
  await expect(list.getByRole("option").first()).toHaveText("Taskskanban");
  await box.press("ArrowDown");
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(page).toHaveURL("/w/globex/board");

  // A status filters the tasks; Enter with nothing highlighted searches for the words.
  await box.fill("in progress");
  await expect(list.getByRole("option", { name: "In progress tasks" })).toBeVisible();
  await box.press("Enter");
  await expect(page).toHaveURL("/w/globex/search?q=in+progress");
});

test("the calendar counts the tasks it cannot place, and the table lists just those", async ({ page }) => {
  await page.goto("/w/globex/board?view=calendar");
  await page.getByRole("link", { name: "See them in the table" }).click();
  await expect(page).toHaveURL("/w/globex/board?view=table&due=none");
  await expect(page.getByText("Showing tasks with no due date.")).toBeVisible();
  await expect(page.locator("tbody tr")).not.toHaveCount(0);
  for (const due of await page.locator("tbody tr td:nth-child(4)").allTextContents()) expect(due).toBe("None");
  await page.getByRole("link", { name: "Show every task" }).click();
  await expect(page).toHaveURL("/w/globex/board?view=table");
});

test("the board lanes follow the stations in order", async ({ page }) => {
  await page.goto("/w/globex/board");
  const lanes = page.locator("section[aria-labelledby^=lane-] h2");
  await expect(lanes).toHaveText(["Inbox", "Backlog", "To do", "In progress", "Done"]);
  await expect(lane(page, "backlog")).toContainText("Evaluate a second payroll provider");
  await expect(lane(page, "in_progress")).toContainText("Chase three overdue invoices");

  // Two horizontal lanes: work waiting on a person, and work agents carry.
  const people = (stage: string) => lane(page, stage).locator('[data-swimlane="people"]');
  const agents = (stage: string) => lane(page, stage).locator('[data-swimlane="agents"]');
  await expect(people("in_progress")).toContainText("Chase three overdue invoices"); // a decision waits on you
  await expect(agents("in_progress")).toContainText("Map Stripe products to partner tiers"); // held by an agent
  await expect(lane(page, "in_progress").getByRole("group", { name: "People: In progress" })).toBeVisible();

  // Done folds each lane to its latest five.
  const doneAgents = agents("done").locator("article[data-task]");
  await expect(doneAgents.filter({ visible: true })).toHaveCount(5);
  await agents("done").getByText(/^Show \d+ more$/).click();
  await expect(doneAgents.filter({ visible: true })).toHaveCount(await doneAgents.count());
  await expect(agents("done").getByText("Show fewer")).toBeVisible();
});

for (const width of [1440, 1024]) {
  test(`at ${width}px, a lane's name stays on screen while its People row scrolls past to Agents`, async ({ page }) => {
    // A short window, so In progress's Agents row starts well below its header.
    await page.setViewportSize({ width, height: 480 });
    await page.goto("/w/globex/board");
    const lane = page.locator('[data-stage="in_progress"]');
    const agents = lane.locator('[data-swimlane="agents"]');
    await agents.scrollIntoViewIfNeeded();
    await expect(agents).toBeInViewport();
    await expect(lane.getByRole("heading", { level: 2, name: "In progress" })).toBeInViewport({ ratio: 1 });
  });
}

test("the People and Agents rows can be switched off, and the choice is remembered", async ({ page }) => {
  await page.goto("/w/globex/board");
  const rows = page.getByRole("group", { name: "Board rows" });
  await expect(page.locator("[data-swimlane]").first()).toBeVisible();
  await rows.getByText("One row", { exact: true }).click();
  await expect(page.locator("[data-swimlane]")).toHaveCount(0);
  await expect(lane(page, "in_progress")).toContainText("Chase three overdue invoices");
  await page.reload();
  await expect(page.locator("[data-swimlane]")).toHaveCount(0);
  await expect(rows.getByRole("radio", { name: "One row" })).toBeChecked();
  await rows.getByText("People and agents", { exact: true }).click();
  await expect(page.locator('[data-swimlane="people"]').first()).toBeVisible();
});

test("the workspaces table shows open work per workspace", async ({ page }) => {
  await page.goto("/workspaces");
  for (const name of ["Acme Corp", "Globex"]) {
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByRole("img", { name: new RegExp(`^${name} open work: `) })).toBeVisible();
  }
});
