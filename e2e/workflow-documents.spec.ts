import { expect, test } from "@playwright/test";

import { newWorkspace } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { lane } from "./support/locators";
import { openTab } from "./support/navigation";

interface Task {
  id: string;
}

/**
 * An owner shapes the board's stages in Settings (a stage renamed, one added, one hidden), and the
 * board, the move menu and the agent all follow. An agent hands its work over as a document the
 * person reads and edits in Phean, Mermaid diagram and all.
 */
test("stages are set in Settings, and documents carry the work between agents and people", async ({ page }) => {
  test.slow();
  const { slug } = await newWorkspace(page, "Hooli");
  await openTab(page, slug, "Agents");
  const token = await issueToken(page, "Writer");

  await test.step("Settings renames To do, adds a Review stage and hides Backlog", async () => {
    // Settings sit in the workspace menu, not on the tab rail.
    await page.locator("details").filter({ has: page.locator("summary", { hasText: "Hooli" }) }).first().locator("summary").click();
    await page.getByRole("link", { name: "Settings for Hooli" }).click();
    await expect(page).toHaveURL(`/w/${slug}/settings`);

    await page.getByRole("textbox", { name: "Name of the To do stage" }).fill("Ready");
    const progress = page.locator('fieldset[data-kind="in_progress"]');
    await progress.getByRole("button", { name: "Add a stage to In progress" }).click();
    await progress.getByRole("textbox", { name: "Stage name" }).fill("Review");
    await page.locator('fieldset[data-kind="backlog"]').getByRole("checkbox", { name: "On the board" }).uncheck();
    await page.getByRole("button", { name: "Save stages" }).click();
    await expect(page.locator("[data-status-region]")).toContainText("Saved the board's stages");
    await expect(page.getByRole("button", { name: "Save stages" })).toBeDisabled();
  });

  const task = await test.step("an agent sees the stages, captures a task and attaches its draft", async () =>
    asAgent(token, async (agent) => {
      const { workflow } = await agent.call<{ workflow: { key: string; label: string }[] }>("whoami");
      expect(workflow.map((stage) => stage.label)).toEqual(["Inbox", "Backlog", "Ready", "In progress", "Review", "Done"]);
      const { created } = await agent.call<{ created: Task[] }>("capture_tasks", { tasks: [{ title: "Write the launch post", status: "todo" }] });
      const [captured] = created as [Task];
      await agent.call("attach_document", {
        title: "Launch post draft",
        taskId: captured.id,
        summary: "First draft, for review",
        content: "# Launch post\n\nWe are live.\n\n```mermaid\nflowchart LR\n  Draft --> Review --> Publish\n```\n",
      });
      return captured;
    }),
  );

  await test.step("the board shows the stages as lanes, and the card its document", async () => {
    await openTab(page, slug, "Board");
    await expect(page.locator("section[data-stage] h2")).toHaveText(["Inbox", "Ready", "In progress", "Review", "Done"]);
    const card = lane(page, "todo").locator(`[data-task="${task.id}"]`);
    await expect(card.getByRole("list", { name: "Documents" })).toContainText("Launch post draft");

    const more = card.locator("details").filter({ has: page.locator('summary[aria-label^="More actions for"]') });
    await more.locator("summary").click();
    await more.getByRole("group", { name: "Move to" }).getByRole("button", { name: "Review" }).click();
    await expect(lane(page, "review").locator(`[data-task="${task.id}"]`)).toBeVisible();
    await expect(page.locator("[data-status-region]")).toContainText("Moved “Write the launch post” to Review");
  });

  await test.step("the agent reads where the task stands", async () => {
    await asAgent(token, async (agent) => {
      const { task: read } = await agent.call<{ task: { status: string; stage: string } }>("get_task", { taskId: task.id });
      expect(read).toMatchObject({ status: "in_progress", stage: "review" });
    });
  });

  await test.step("the person opens the draft, edits it with a live preview, and saves a new version", async () => {
    await lane(page, "review").locator(`[data-task="${task.id}"]`).getByRole("link", { name: "Launch post draft" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Launch post draft");
    await expect(page.locator('[data-diagram="drawn"] svg')).toBeVisible();
    await expect(page.getByText("Version 1 · by Writer")).toBeVisible();

    await page.getByRole("link", { name: "Edit" }).click();
    const text = page.getByRole("textbox", { name: "Text" });
    await text.fill("# Launch post\n\nWe are live, and **free** for a month.\n\n| Plan | Price |\n| --- | --- |\n| Team | $0 |\n");
    await expect(page.getByRole("region", { name: "Preview" }).getByRole("table")).toContainText("Team");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/documents\/d_[a-z0-9]+$/);
    await expect(page.locator("[data-markdown] strong")).toHaveText("free");
    await expect(page.getByText(/Version 2 · edited by/)).toBeVisible();
  });

  await test.step("the agent gets the person's edit", async () => {
    await asAgent(token, async (agent) => {
      const { documents } = await agent.call<{ documents: { id: string; version: number }[] }>("list_documents", { taskId: task.id });
      expect(documents).toEqual([expect.objectContaining({ version: 2 })]);
      const { content } = await agent.call<{ content: string }>("get_document", { documentId: documents[0]!.id });
      expect(content).toContain("free** for a month");
    });
  });
});
