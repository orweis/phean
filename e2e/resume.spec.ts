import { expect, test } from "@playwright/test";

import { newWorkspace } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { card, lane, popover } from "./support/locators";
import { openTab } from "./support/navigation";

interface Task {
  id: string;
  title: string;
  description: string;
}

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const CHAT = "https://claude.ai/chat/0b7e4c1d-e2e0-4f5a-9d3c-1a2b3c4d5e6f";
const SESSION_ID = "8d2f6a10-3c4b-4e7f-a1d9-5b6c7d8e9f01";
const MAIL = "https://mail.google.com/mail/u/0/#inbox/FMfcgzQXe2eRenewal";
const ANSWER = "Offer 5% if they sign this week.";

/**
 * An agent that needs a person leaves the way back into its own conversation: a link where it
 * has one, otherwise ids and a command to copy. The person sees what waits on them, resumes the
 * conversation in one click, or answers in Phean, and the agent reads the answer on the task.
 */
test("a person picks up an agent's question where the agent left off", async ({ page }) => {
  test.slow();
  const { slug, owner } = await newWorkspace(page, "Soylent");
  let token = "";
  let renewal: Task;
  let hiring: Task;

  await test.step("an agent links its sessions and asks two questions", async () => {
    await openTab(page, slug, "Agents");
    token = await issueToken(page, "Deal desk");
    await asAgent(token, async (agent) => {
      const { created } = await agent.call<{ created: Task[] }>("capture_tasks", {
        tasks: [
          { title: "Price the Globex renewal", source: "email", sourceRef: MAIL, status: "todo" },
          { title: "Shortlist the support hires", source: "slack", sourceRef: "slack:C1/p2", status: "todo" },
        ],
      });
      [renewal, hiring] = created as [Task, Task];

      await agent.call("claim_task", {
        taskId: renewal.id,
        session: { url: CHAT, app: "Claude", brief: "Drafted the quote; the discount needs a yes." },
      });
      await agent.call("request_input", { taskId: renewal.id, question: "Globex wants 10% off the renewal. Offer 5%, or hold the list price?" });

      await agent.call("link_session", {
        taskId: hiring.id,
        session: { app: "Claude Code", sessionId: SESSION_ID, command: `claude --resume ${SESSION_ID}`, brief: "Read all 40 CVs." },
      });
      await agent.call("request_input", { taskId: hiring.id, question: "Keep the shortlist to five, or widen it to eight?" });
    });
  });

  await test.step("the overview leads with the questions, each with its way back", async () => {
    // A full load: on client navigation the tab rail's counts catch up on their 15-second refresh.
    await page.goto(`/w/${slug}`);
    await expect(page.getByText("2 agent questions await your answer and 2 tasks are open.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: /^Overview/ })).toHaveAccessibleName(
      "Overview 2 waiting on you",
    );

    const questions = card(page, "2 agent questions waiting on you");
    const asked = questions.locator(`[data-task="${renewal.id}"]`);
    await expect(asked).toContainText("Deal desk asked just now in Claude");
    await expect(asked.locator("blockquote")).toHaveText("Globex wants 10% off the renewal. Offer 5%, or hold the list price?");
    const resume = asked.getByRole("link", { name: "Resume in Claude (opens in a new tab)" });
    await expect(resume).toHaveAttribute("href", CHAT);
    await expect(resume).toHaveAttribute("target", "_blank");
    await expect(resume).toHaveAttribute("rel", "noopener noreferrer");

    const noLink = questions.locator(`[data-task="${hiring.id}"]`);
    await expect(noLink.getByRole("link", { name: /^Resume/ })).toHaveCount(0);
    await expect(popover(noLink, "Resume").locator("summary")).toBeVisible();
  });

  await test.step("board cards show the question and every way back into the session", async () => {
    await openTab(page, slug, "Board");
    const claimed = lane(page, "in_progress").locator(`[data-task="${renewal.id}"]`);
    await expect(claimed).toContainText("Deal desk asks: Globex wants 10% off the renewal.");
    const source = claimed.getByRole("link", { name: "From email (opens in a new tab)" });
    await expect(source).toHaveAttribute("href", MAIL);

    const resume = popover(claimed, "Resume");
    await resume.locator("summary").click();
    await expect(resume).toContainText("Pick up where Deal desk left off");
    await expect(resume).toContainText("Drafted the quote; the discount needs a yes.");
    await expect(resume.getByRole("link", { name: "Resume in Claude (opens in a new tab)" })).toHaveAttribute("href", CHAT);
    await page.keyboard.press("Escape");

    const unclaimed = lane(page, "todo").locator(`[data-task="${hiring.id}"]`);
    await expect(unclaimed.getByText("From slack")).toBeVisible();
    await expect(unclaimed.getByRole("link", { name: /^From slack/ })).toHaveCount(0);
    const references = popover(unclaimed, "Resume");
    await references.locator("summary").click();
    await expect(references).toContainText("in Claude Code");
    await expect(references).toContainText("Read all 40 CVs.");
    await expect(references.getByRole("link")).toHaveCount(0);
    const copy = references.getByRole("button", { name: /session id$/ });
    await expect(copy).toHaveAccessibleName("Copy session id");
    await copy.click();
    await expect(copy).toHaveAccessibleName("Copied session id");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SESSION_ID);
    await references.getByRole("button", { name: "Copy resume command" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`claude --resume ${SESSION_ID}`);
    await page.keyboard.press("Escape");

    // The badge leads to the very entry, which the page scrolls to.
    await unclaimed.getByRole("link", { name: "Waiting on you" }).click();
    await expect(page).toHaveURL(`/w/${slug}/decisions#task-${hiring.id}`);
    await expect(card(page, "2 requests waiting on you")).toBeVisible();
    await expect(page.locator(`#task-${hiring.id}`)).toBeInViewport();
    await openTab(page, slug, "Overview");
    await expect(card(page, "2 agent questions waiting on you")).toBeVisible();
  });

  await test.step("the person answers one question here and marks the other answered", async () => {
    const asked = page.locator(`#questions [data-task="${renewal.id}"]`);
    const form = popover(asked, "Answer here");
    await form.locator("summary").click();
    // The panel repeats the question and takes focus in its field.
    await expect(form).toContainText("Offer 5%, or hold the list price?");
    const field = form.getByRole("textbox", { name: "Answer" });
    await expect(field).toBeFocused();
    await field.fill(ANSWER);
    await form.getByRole("button", { name: "Send" }).click();
    await expect(asked).toHaveCount(0);
    await expect(page.locator("[data-status-region]")).toContainText("Sent your answer to Deal desk");
    await expect(card(page, "1 agent question waiting on you")).toBeVisible();

    // Saying it was answered in the conversation is rare, so it sits in ⋯ and asks first.
    const entry = page.locator(`#questions [data-task="${hiring.id}"]`);
    const more = entry.locator("details").filter({ has: page.locator('summary[aria-label="More for Shortlist the support hires"]') });
    await more.locator("summary").click();
    page.once("dialog", (dialog) => dialog.accept());
    await more.getByRole("button", { name: "Answered in the conversation" }).click();
    await expect(page.locator("#questions")).toHaveCount(0);
    await expect(page.getByText("2 tasks are open.", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: /^Overview/ })).toHaveAccessibleName("Overview");
    await expect(card(page, "Activity")).toContainText("answered questions on 2 tasks");
  });

  await test.step("the agent reads the answer on the task", async () => {
    await asAgent(token, async (agent) => {
      const { events } = await agent.call<{ events: { action: string; entityId: string; data: { answer: string } }[] }>("get_activity", { limit: 2 });
      expect(events).toEqual([
        expect.objectContaining({ action: "task.input_answered", entityId: hiring.id, data: expect.objectContaining({ answer: "" }) }),
        expect.objectContaining({ action: "task.input_answered", entityId: renewal.id, data: expect.objectContaining({ answer: ANSWER }) }),
      ]);
      const { tasks } = await agent.call<{ tasks: (Task & { inputRequest: unknown })[] }>("list_tasks", { claimed: "mine" });
      expect(tasks).toEqual([expect.objectContaining({ id: renewal.id, inputRequest: null })]);
      expect(tasks[0]!.description).toContain(`Answer from ${owner.name}: ${ANSWER}`);
    });
  });
});
