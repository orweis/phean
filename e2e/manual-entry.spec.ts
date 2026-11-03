import { expect, test } from "@playwright/test";

import { newWorkspace } from "./support/accounts";
import { card, entryKind, lane, popover, utcDay } from "./support/locators";

/**
 * Agents fill the ledger; people can still add a task or goal by hand. These tests cover every
 * manual entry point, and that each stays a quiet ghost button rather than a page's main action.
 */
test("a person adds tasks and goals by hand from quiet entry points", async ({ page }) => {
  test.slow();
  const { slug } = await newWorkspace(page, "Umbrella");
  const entry = popover(page, "Add manually");
  const trigger = entry.locator("summary");

  await test.step("the overview offers manual entry beside, not instead of, connecting an agent", async () => {
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.getByRole("link", { name: "Connect an agent" })).toBeVisible();
    await expect(entry.getByRole("textbox", { name: "Task" })).toBeHidden();
  });

  await test.step("add a task from the overview", async () => {
    await trigger.click();
    await expect(entry.getByRole("radio", { name: "Task" })).toBeChecked();
    await expect(entry.getByRole("textbox", { name: "Title" })).toBeHidden();
    await entry.getByRole("textbox", { name: "Task" }).fill("Order the new door badges");
    await entry.getByRole("combobox", { name: "Priority" }).selectOption("high");
    await entry.getByRole("button", { name: "Add task" }).click();
    await expect(entry.getByRole("status")).toHaveText("Task added.");
    await expect(entry.getByRole("textbox", { name: "Task" })).toHaveValue("");
    await expect(card(page, "Next actions")).toContainText("Order the new door badges");
  });

  await test.step("Escape closes the panel", async () => {
    await page.keyboard.press("Escape");
    await expect(entry.getByRole("textbox", { name: "Task" })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  let goalUrl = "";
  await test.step("start a goal from the overview", async () => {
    await trigger.click();
    await entryKind(entry, "Goal").click();
    await expect(entry.getByRole("radio", { name: "Goal" })).toBeChecked();
    await expect(entry.getByRole("textbox", { name: "Task" })).toBeHidden();
    await entry.getByRole("textbox", { name: "Title" }).fill("Move to the new office");
    await entry.getByRole("button", { name: "Create goal" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/goals/g_`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Move to the new office");
    await expect(page.getByRole("button", { name: "Mark achieved" })).toBeVisible();
    goalUrl = new URL(page.url()).pathname;
  });

  await test.step("add a task and a sub-goal on the goal page", async () => {
    const addTask = popover(page, "Add task");
    await expect(addTask.locator("summary")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await addTask.locator("summary").click();
    await expect(addTask.getByRole("combobox", { name: "Goal" })).toHaveCount(0);
    await addTask.getByRole("textbox", { name: "Task" }).fill("Book the movers");
    await addTask.getByLabel("Due date").fill(utcDay(5));
    await addTask.getByRole("button", { name: "Add task" }).click();
    await expect(addTask.getByRole("status")).toHaveText("Task added.");
    await expect(card(page, "Tasks").locator("li[data-task]")).toContainText(["Book the movers"]);
    await expect(card(page, "Timetable").locator("li[data-task]")).toContainText(["Book the movers"]);
    await page.keyboard.press("Escape");

    const addSubGoal = popover(page, "Add sub-goal");
    await addSubGoal.locator("summary").click();
    await addSubGoal.getByRole("textbox", { name: "Title" }).fill("Pack the archive");
    await addSubGoal.getByRole("button", { name: "Add sub-goal" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pack the archive");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Move to the new office" })).toHaveAttribute(
      "href",
      goalUrl,
    );
  });

  await test.step("the board files a task under the goal it is filtered to", async () => {
    const goalId = goalUrl.split("/").pop()!;
    await page.goto(`/w/${slug}/board?goal=${goalId}`);
    await trigger.click();
    await expect(entry.getByRole("combobox", { name: "Goal" })).toHaveValue(goalId);
    await entry.getByRole("textbox", { name: "Task" }).fill("Label the boxes");
    await entry.getByRole("button", { name: "Add task" }).click();
    await expect(lane(page, "todo")).toContainText("Label the boxes");
    await expect(lane(page, "todo")).toContainText("Book the movers");
    await expect(lane(page, "todo")).not.toContainText("Order the new door badges");
  });
});
