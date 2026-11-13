import { expect, test } from "@playwright/test";

import { newWorkspace } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { expectAccessible } from "./support/checks";
import { lane, popover } from "./support/locators";
import { openTab } from "./support/navigation";

interface Task {
  id: string;
  title: string;
  delegation: string | null;
  delegationNote: string;
}

const NOTE = "Outline is in the doc. Needs the pricing section and a final read.";

/**
 * A task's operator is whoever works on it now, and delegation is the handover between them: a
 * person starts a task, hands it to an agent with a note, and the agent picks it up with the note.
 */
test("a person starts a task, hands it to an agent with a note, and the agent picks it up", async ({ page }) => {
  test.slow();
  const { slug, owner } = await newWorkspace(page, "Initech");
  let token = "";
  let task: Task;
  const taskCard = () => page.locator(`article[data-task="${task.id}"]`);

  await test.step("an agent captures a task for later", async () => {
    await openTab(page, slug, "Agents");
    token = await issueToken(page, "Writer");
    task = await asAgent(token, async (agent) => {
      const { created } = await agent.call<{ created: Task[] }>("capture_tasks", { tasks: [{ title: "Write the changelog", status: "todo" }] });
      return created[0]!;
    });
  });

  await test.step("Start makes the person its operator", async () => {
    await page.goto(`/w/${slug}/board`);
    await taskCard().getByRole("button", { name: "Start" }).click();
    await expect(page.locator("[data-status-region]")).toContainText("Started “Write the changelog”");
    await expect(lane(page, "in_progress").locator(`[data-task="${task.id}"]`)).toContainText(`Operator: ${owner.name}`);
  });

  await test.step("the person hands it to the agent with a note", async () => {
    await page.goto(`/w/${slug}/tasks/${task.id}`);
    const panel = popover(page, "Hand off");
    await panel.locator("summary").click();
    await panel.getByLabel("To").selectOption({ label: "Writer" });
    await panel.getByLabel("Handoff note").fill(NOTE);
    await expectAccessible(page);
    await panel.getByRole("button", { name: "Hand off" }).click();
    await expect(page.locator("[data-status-region]")).toContainText("Handing off “Write the changelog”");
    await expect(page.getByText("Handing off to Writer")).toBeVisible();
    // It stays the person's until the agent takes it.
    await expect(page.getByText(`Operator: ${owner.name}`)).toBeVisible();
    await expect(page.getByRole("figure").filter({ hasText: "Handoff note" })).toContainText(NOTE);
  });

  await test.step("the agent finds it handed to it, and picks it up with the note", async () => {
    await asAgent(token, async (agent) => {
      const { tasks: handed } = await agent.call<{ tasks: Task[] }>("list_tasks", { claimed: "handed_to_me" });
      expect(handed.map((row) => row.id)).toEqual([task.id]);
      const { task: picked } = await agent.call<{ task: Task }>("claim_task", { taskId: task.id });
      expect(picked).toMatchObject({ delegation: "picking_up", delegationNote: NOTE });
    });
    await page.goto(`/w/${slug}/tasks/${task.id}`);
    await expect(page.getByText("Operator: Writer")).toBeVisible();
    await expect(page.getByText("Picking up", { exact: true })).toBeVisible();
  });

  await test.step("the person takes it back from the menu", async () => {
    await page.goto(`/w/${slug}/board`);
    const more = taskCard().locator("details").filter({ has: page.locator('summary[aria-label="More actions for Write the changelog"]') });
    await more.locator("summary").click();
    await more.getByRole("button", { name: "Take over from Writer" }).click();
    await expect(taskCard()).toContainText(`Operator: ${owner.name}`);
  });
});
