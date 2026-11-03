import { expect, test } from "@playwright/test";

import { isoDayFromToday } from "../src/lib/dates";
import { slugify } from "../src/lib/domain";
import { createWorkspace, newPerson, runId, signUp } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { card, lane } from "./support/locators";
import { openTab } from "./support/navigation";

interface Task {
  id: string;
  title: string;
}

/**
 * The whole loop on a fresh account: a person signs up and connects an agent, the agent
 * proposes a goal and captures work over MCP, the person approves it, moves the work along,
 * and reads it back on the diagrams.
 */
test("an owner and an agent run a workspace end to end", async ({ page }) => {
  test.slow();
  const run = runId();
  const workspace = { name: `Initech ${run}`, slug: slugify(`Initech ${run}`) };
  let token = "";
  let goalId = "";
  let tasks: Record<"late" | "claimed" | "unfiled", Task>;

  await test.step("sign up", async () => {
    await signUp(page, newPerson("Olive Owner"));
    await expect(page.getByText("No workspaces yet")).toBeVisible();
  });

  await test.step("create a workspace", async () => {
    await createWorkspace(page, workspace.name);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(workspace.name);
    await expect(page.getByText("Nothing is waiting on you.")).toBeVisible();
  });

  await test.step("issue an agent token", async () => {
    await page.getByRole("link", { name: "Connect an agent" }).click();
    await expect(page).toHaveURL(`/w/${workspace.slug}/agents`);
    token = await issueToken(page, "Inbox sweeper");
    await expect(page.getByRole("tablist", { name: "MCP client" }).getByRole("tab")).not.toHaveCount(0);
    await expect(page.getByRole("tabpanel")).toContainText(token);
  });

  await test.step("the agent proposes a goal and captures work over MCP", async () => {
    await asAgent(token, async (agent) => {
      const me = await agent.call<{ workspace: { slug: string } }>("whoami");
      expect(me.workspace.slug).toBe(workspace.slug);

      const { goal } = await agent.call<{ goal: { id: string; status: string } }>("create_goal", {
        title: "Close the quarter",
        description: "Books reconciled and the board pack sent.",
      });
      expect(goal.status).toBe("proposed");
      goalId = goal.id;

      const { created } = await agent.call<{ created: Task[] }>("capture_tasks", {
        tasks: [
          { title: "Reconcile the payouts", source: "email", sourceRef: `gmail:${run}/1`, dueDate: isoDayFromToday(-1), goalId },
          { title: "Send the board pack", source: "calendar", sourceRef: `gcal:${run}/2`, dueDate: isoDayFromToday(3), goalId, status: "todo" },
          { title: "Book the offsite venue", source: "slack", sourceRef: `slack:${run}/3` },
        ],
      });
      const [late, claimed, unfiled] = created;
      tasks = { late: late!, claimed: claimed!, unfiled: unfiled! };
      await agent.call("claim_task", { taskId: tasks.claimed.id });
    });
  });

  await test.step("the owner approves the proposed goal", async () => {
    await openTab(page, workspace.slug, "Overview");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(workspace.name);
    await expect(page.getByText("1 goal awaits your decision, 1 task is late, and 3 tasks are open.")).toBeVisible();

    const pending = page.locator(`[data-goal="${goalId}"]`);
    await expect(card(page, "1 goal awaiting your decision")).toBeVisible();
    await expect(pending).toContainText("Proposed by Inbox sweeper");
    await pending.getByRole("button", { name: "Approve" }).click();
    await expect(pending).toHaveCount(0);

    await expect(card(page, "Goal map").getByRole("link", { name: "Close the quarter" })).toBeVisible();
    await expect(card(page, "Late").locator(`[data-task="${tasks.late.id}"]`)).toContainText("Reconcile the payouts");
    await expect(card(page, "Next actions").locator(`[data-task="${tasks.claimed.id}"]`)).toContainText("Inbox sweeper");
    await expect(card(page, "On the line").locator(`[data-task="${tasks.late.id}"]`)).toContainText(/Late, due/);
    await expect(card(page, "Agents")).toContainText("Inbox sweeper");
    await expect(page.getByRole("region", { name: "Today on the line" }).getByRole("img", { name: /Open work by status/ })).toHaveAccessibleName(
      "Open work by status: 2 inbox, 1 in progress",
    );
  });

  await test.step("move a task across the board", async () => {
    await openTab(page, workspace.slug, "Board");
    const task = (status: Parameters<typeof lane>[1]) => lane(page, status).locator(`[data-task="${tasks.unfiled.id}"]`);

    await task("inbox").getByRole("button", { name: "Accept" }).click();
    await task("todo").getByRole("button", { name: "Start" }).click();
    await task("in_progress").getByRole("button", { name: "Done" }).click();
    await expect(task("done")).toContainText("Book the offsite venue");
    await expect(lane(page, "in_progress").locator(`[data-task="${tasks.claimed.id}"]`)).toContainText("Inbox sweeper");
  });

  await test.step("the timeline draws every task's journey", async () => {
    await openTab(page, workspace.slug, "Timeline");
    await expect(page.getByRole("navigation", { name: "Time window" }).getByRole("link", { name: "14 days" })).toHaveAttribute("aria-current", "page");

    const goalTracks = page.getByRole("region", { name: "Close the quarter" });
    await expect(goalTracks.locator("li[data-task]")).toHaveCount(2);
    await expect(goalTracks.locator(`[data-task="${tasks.late.id}"]`)).toContainText(/Late, due/);
    await expect(goalTracks.locator(`[data-task="${tasks.claimed.id}"] [data-segment="in_progress"]`)).toHaveCount(1);

    const unfiled = page.getByRole("region", { name: "Not filed under a goal" }).locator(`[data-task="${tasks.unfiled.id}"]`);
    await expect(unfiled).toContainText("Done");
    await expect(unfiled.locator('[data-end="arrived"]')).toHaveCount(1);
    await expect(card(page, "How the work moved")).toContainText("The flow fills in after a few days");
    await expect(page.getByText(/Where every task stood each day since \w+ \d+\./)).toBeVisible();

    await page.getByRole("link", { name: "30 days" }).click();
    await expect(page).toHaveURL(/days=30/);
    await expect(page.getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "page");
  });

  await test.step("the goal page rolls up its tasks", async () => {
    await page.getByRole("region", { name: "Close the quarter" }).getByRole("link", { name: "Close the quarter" }).click();
    await expect(page).toHaveURL(`/w/${workspace.slug}/goals/${goalId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Close the quarter");
    await expect(page.getByRole("img", { name: /^Tasks by status/ })).toHaveAccessibleName("Tasks by status: 1 inbox, 1 in progress");
    await expect(card(page, "Tasks").locator("li[data-task]")).toHaveCount(2);
  });

  await test.step("the workspaces table shows the new workspace's open work", async () => {
    await page.goto("/workspaces");
    const row = page.getByRole("row").filter({ hasText: workspace.name });
    await expect(row.getByRole("img")).toHaveAccessibleName(`${workspace.name} open work: 1 inbox, 1 in progress`);
  });
});
