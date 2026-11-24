import { expect, test } from "@playwright/test";

import { newWorkspace } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { expectAccessible } from "./support/checks";
import { card } from "./support/locators";
import { openTab } from "./support/navigation";

interface Task {
  id: string;
  title: string;
}

/**
 * A pipeline from end to end: an agent defines it over MCP, a person starts a run, the agent works
 * its stop, the run waits on the person at Decisions with where each answer leads, and their answer
 * ends the trip. The person then changes the line in the editor, which makes a new version.
 */
test("an agent defines a pipeline, a person runs it and decides at its person stop", async ({ page }) => {
  test.slow();
  const { slug, owner } = await newWorkspace(page, "Initrode");
  let token = "";
  let runUrl = "";

  await test.step("an agent defines the line over MCP", async () => {
    await openTab(page, slug, "Agents");
    token = await issueToken(page, "Writer");
    await asAgent(token, (agent) =>
      agent.call("define_pipeline", {
        name: "Release notes",
        kind: "regular",
        definition: {
          stops: [
            { id: "draft", name: "Draft", kind: "agent", agent: "Writer", instructions: "Draft the release notes.", then: { next: "review" } },
            {
              id: "review",
              name: "Review",
              kind: "person",
              person: owner.email,
              instructions: "Publish these release notes?",
              timeLimitMinutes: 600,
              onTimeout: "Hold",
              then: { choice: [{ label: "Publish", end: "published" }, { label: "Hold", end: "held" }] },
            },
          ],
          ends: [
            { id: "published", name: "Published" },
            { id: "held", name: "Held" },
          ],
        },
      }),
    );
  });

  await test.step("the Pipelines tab lists it, and a person starts a run", async () => {
    await openTab(page, slug, "Pipelines");
    const row = page.locator("[data-pipeline]").filter({ hasText: "Release notes" });
    await expect(row).toContainText("No runs yet");
    await expectAccessible(page);
    await row.getByRole("button", { name: "Start run of Release notes" }).click();
    await expect(page).toHaveURL(/\/pipelines\/runs\/r_/);
    runUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Release notes #1");
    await expect(page.locator("[data-run-headline]")).toHaveText("At Draft");
    // Draft was handed to Writer, who has not picked it up yet.
    await expect(page.locator('[data-stop-row="draft"]')).toContainText("Handing off");
    await expect(page.locator('[data-line-map] [data-stop="draft"]')).toContainText("Handing off");
  });

  await test.step("the agent works its stop; the run then waits on the person", async () => {
    await asAgent(token, async (agent) => {
      const { tasks } = await agent.call<{ tasks: Task[] }>("list_tasks", { claimed: "handed_to_me" });
      expect(tasks.map((task) => task.title)).toEqual(["Draft"]);
      await agent.call("claim_task", { taskId: tasks[0]!.id });
      await agent.call("complete_task", { taskId: tasks[0]!.id, note: "Drafted: 12 fixes, 3 features." });
    });
    await page.goto(runUrl);
    await expect(page.locator("[data-run-headline]")).toHaveText(`Waiting on ${owner.name} at Review`);
    await expect(page.locator('[data-stop-row="draft"]')).toContainText("Drafted: 12 fixes, 3 features.");
    // The run page lands on the stop that waits on the person.
    await expect(page.locator('[data-stop-row="review"]')).toHaveAttribute("aria-current", "true");
    await expect(page.locator("[data-selected-stop]")).toContainText(`Waiting on ${owner.name}`);
    await page.getByRole("navigation", { name: "Run views" }).getByRole("link", { name: "Timeline" }).click();
    await expect(page.locator('[data-run-timeline] [data-segment="waiting"]')).toBeVisible();
    await expectAccessible(page);
  });

  await test.step("the stop's task shows where it sits on the line", async () => {
    await page.goto(runUrl);
    await page.locator("[data-selected-stop]").getByRole("link", { name: "Open the decision" }).click();
    const strip = page.locator("[data-task-line]").first();
    await expect(strip).toContainText("A stop of Release notes #1");
    await expect(strip.locator('[aria-current="step"]')).toContainText("Review");
  });

  await test.step("Decisions pins the run's decision, says where each answer leads, and the answer ends the trip", async () => {
    await page.goto(`/w/${slug}/decisions`);
    const pinned = card(page, "Pipelines: 1 run waiting on you");
    await expect(pinned).toContainText("Pipeline");
    await expect(pinned).toContainText("Stop 2 of 2 · Release notes #1");
    await expect(pinned.getByRole("list", { name: "What each answer leads to" })).toContainText("Publish → leads to Ends: Published");
    await expect(pinned).toContainText("Time limit in 10 hours; then the run goes with “Hold”");
    await expectAccessible(page);
    await pinned.getByRole("button", { name: "Publish" }).click();
    await expect(page.locator("[data-status-region]")).toContainText("Sent “Publish” to Release notes #1; the run has it now");
    await expect(page.locator("[data-status-region]").getByRole("button", { name: "Undo" })).toHaveCount(0);
    await page.goto(runUrl);
    await expect(page.locator("[data-run-headline]")).toHaveText("Ended: Published");
  });

  await test.step("the pipeline's runs and insights show the trip", async () => {
    await page.goto(`/w/${slug}/pipelines`);
    await page.getByRole("link", { name: "Release notes" }).click();
    await page.getByRole("navigation", { name: "Pipeline views" }).getByRole("link", { name: "Runs" }).click();
    await expect(page.locator('[data-grid-stop="review"] [data-cell="done"]')).toHaveCount(1);
    await page.getByRole("navigation", { name: "Pipeline views" }).getByRole("link", { name: "Insights" }).click();
    await expect(page.getByText("1 of 1 finished run")).toBeVisible();
  });

  await test.step("a person adds a stop in the editor, which saves a new version", async () => {
    await page.getByRole("navigation", { name: "Pipeline views" }).getByRole("link", { name: "Definition" }).click();
    await page.locator("[data-pipeline-editor]").getByRole("button", { name: "Add stop after" }).first().click();
    await expect(page.getByLabel("Name").nth(1)).toHaveValue("New stop");
    await expect(page.getByRole("region", { name: "Preview of Release notes's line" })).toContainText("New stop");
    await page.getByRole("button", { name: "Save version" }).click();
    await expect(page.locator("[data-status-region]")).toContainText("Saved “Release notes”");
    await expect(page.locator('[data-version="2"]')).toContainText("Current");
    await page.locator('[data-version="2"]').getByRole("link", { name: "Show changes" }).click();
    await expect(page.locator('[data-version="2"] [data-diff]')).toContainText('Added the stop "New stop"');
  });
});
