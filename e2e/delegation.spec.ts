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

  await test.step("the board shows the handoff with a dashed edge, and the Handoff filter finds it", async () => {
    await asAgent(token, (agent) => agent.call("hand_off_task", { taskId: task.id, toPerson: owner.email, note: "Drafted; needs your sign-off on the wording." }));
    await page.goto(`/w/${slug}/board`);
    await expect(taskCard()).toContainText(`Handing off to ${owner.name}`);
    await expect(taskCard()).toHaveCSS("border-top-style", "dashed");
    await page.goto(`/w/${slug}/board?view=table&handoff=to_me`);
    await expect(page.getByRole("combobox", { name: "Filter by handoff" })).toHaveValue("to_me");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText("Write the changelog");
  });

  await test.step("the overview lists it for the person, who takes it from there", async () => {
    await page.goto(`/w/${slug}`);
    const handoffs = page.getByRole("list", { name: "Handoffs" });
    const entry = handoffs.getByRole("listitem").filter({ hasText: "Write the changelog" });
    await expect(entry).toContainText("For you");
    await expect(entry).toContainText("Drafted; needs your sign-off on the wording.");
    await entry.getByRole("button", { name: "Take it" }).click();
    await expect(page.locator("[data-status-region]")).toContainText("You're working on “Write the changelog”");
    await page.goto(`/w/${slug}/tasks/${task.id}`);
    await expect(page.getByText(`Operator: ${owner.name}`)).toBeVisible();
    await expect(page.getByText("Picking up", { exact: true })).toBeVisible();
  });
});
