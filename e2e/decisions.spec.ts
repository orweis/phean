import { expect, test } from "@playwright/test";

import { newWorkspace } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { card, lane, popover } from "./support/locators";
import { openTab } from "./support/navigation";

interface Task {
  id: string;
  title: string;
}

interface WaitResult {
  answers: { taskId: string; answer: string; chosenOption: string | null }[];
  timedOut: boolean;
}

const CHAT = "https://claude.ai/chat/2a9c7e4b-e2e0-4d1a-8f3b-6c5d4e3f2a10";
const MAIL = "https://mail.google.com/mail/u/0/#inbox/FMfcgzAuditQuote";
const QUESTION = "Hire Rivera & Co. or Okafor LLP for the Q3 audit?";
const COURIER = "Which courier takes the signed engagement letter?";

/**
 * An agent asks a person to decide and waits on it. The person sees the request on the Decisions
 * page with the agent's context and links, picks an option, and the waiting agent wakes with it.
 */
test("an agent waits on a decision and wakes when the person makes it", async ({ page }) => {
  test.slow();
  const { slug, owner } = await newWorkspace(page, "Initech");
  await openTab(page, slug, "Agents");
  const token = await issueToken(page, "Auditor scout");

  const [task, courier] = await asAgent(token, async (agent) => {
    const { created } = await agent.call<{ created: Task[] }>("capture_tasks", {
      tasks: [
        { title: "Engage the Q3 auditor", status: "todo", links: [{ url: MAIL, title: "Quotes email", kind: "source" }] },
        { title: "Send the engagement letter", status: "todo" },
      ],
    });
    const [captured, letter] = created as [Task, Task];
    await agent.call("request_input", { taskId: letter.id, kind: "decision", question: COURIER, options: ["DHL", "UPS"] });
    await agent.call("request_input", {
      taskId: captured.id,
      kind: "decision",
      question: QUESTION,
      context: "Rivera is $4k cheaper; Okafor did last year's audit. I recommend Okafor.",
      options: ["Rivera & Co.", "Okafor LLP"],
      links: [
        { url: CHAT, title: "This chat", kind: "conversation" },
        { url: MAIL, title: "Quotes email", kind: "source" },
      ],
    });
    return [captured, letter] as const;
  });

  // A second connection holds wait_for_answers open while the person decides, as a waiting agent would.
  const woken = asAgent(token, (agent) => agent.call<WaitResult>("wait_for_answers", { taskIds: [task.id], timeoutSeconds: 50 }));

  await test.step("the Decisions page shows the request with its context and links", async () => {
    await page.goto(`/w/${slug}/decisions`);
    await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: /^Decisions/ })).toHaveAccessibleName(
      "Decisions 2 waiting on you",
    );
    const request = card(page, "2 requests waiting on you").locator(`[data-task="${task.id}"]`);
    await expect(request.locator("blockquote")).toHaveText(QUESTION);
    await expect(request).toContainText("I recommend Okafor.");
    await expect(request.getByText("Decision", { exact: true }).first()).toBeVisible();
    const chat = request.getByRole("link", { name: /^This chat/ });
    await expect(chat).toHaveAttribute("href", CHAT);
    await expect(chat).toHaveAttribute("target", "_blank");
    await expect(request.getByRole("link", { name: /^Quotes email/ })).toHaveAttribute("href", MAIL);

    // The options come first, each with its number key.
    const options = request.getByRole("group", { name: /^Answer / });
    await expect(options.getByRole("button", { name: "Okafor LLP" })).toHaveAttribute("aria-keyshortcuts", "2");
    await options.getByRole("button", { name: "Okafor LLP" }).click();
    const status = page.locator("[data-status-region]");
    await expect(status).toContainText("Sent “Okafor LLP” to Auditor scout");
    await expect(card(page, "1 request waiting on you").locator(`[data-task="${task.id}"]`)).toHaveCount(0);
  });

  await test.step("a mis-click is taken back with Undo, before the agent collects it", async () => {
    const letter = card(page, "1 request waiting on you").locator(`[data-task="${courier.id}"]`);
    await letter.getByRole("button", { name: "DHL" }).click();
    const status = page.locator("[data-status-region]");
    await expect(status).toContainText("Sent “DHL” to Auditor scout");
    await expect(card(page, "Nothing waiting on you")).toBeVisible();
    await status.getByRole("button", { name: "Undo" }).click();
    await expect(status).toContainText("Auditor scout's question is open again.");
    const reopened = card(page, "1 request waiting on you").locator(`[data-task="${courier.id}"]`);
    await expect(reopened.locator("blockquote")).toHaveText(COURIER);

    // From the keyboard: with the entry focused, 2 picks its second option.
    await reopened.focus();
    await page.keyboard.press("2");
    await expect(status).toContainText("Sent “UPS” to Auditor scout");
    await expect(card(page, "Nothing waiting on you")).toBeVisible();
  });

  await test.step("the waiting agent wakes with the decision", async () => {
    const result = await woken;
    expect(result).toMatchObject({ timedOut: false, answers: [{ taskId: task.id, answer: "Okafor LLP", chosenOption: "Okafor LLP" }] });
  });

  await test.step("the answer stays on the Decisions page, marked as picked up", async () => {
    await page.reload();
    const answered = card(page, "Answered").locator(`[data-task="${task.id}"]`);
    await expect(answered.getByRole("list", { name: "Options offered" })).toContainText("Okafor LLP (chosen)");
    await expect(answered).toContainText(`by ${owner.name}`);
    await expect(answered).toContainText("Auditor scout has it");
  });

  await test.step("the board shows the task's links, edits it, and moves it by drag and drop", async () => {
    await openTab(page, slug, "Board");
    const todo = lane(page, "todo").locator(`[data-task="${task.id}"]`);
    await expect(todo.getByRole("link", { name: /^Quotes email/ })).toHaveAttribute("href", MAIL);

    const edit = popover(todo, "Edit");
    await edit.locator("summary").click();
    await edit.getByLabel("Title").fill("Engage Okafor LLP for the Q3 audit");
    await edit.getByLabel("Priority").selectOption("high");
    await edit.getByLabel("Due date").fill("2031-09-30");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("[data-status-region]")).toContainText("Saved “Engage the Q3 auditor”");
    await expect(edit).not.toHaveAttribute("open");
    const edited = lane(page, "todo").locator(`[data-task="${task.id}"]`);
    await expect(edited).toContainText("Engage Okafor LLP for the Q3 audit");
    await expect(edited).toContainText("High");
    await expect(edited).toContainText("Due Sep 30");

    await edited.dragTo(lane(page, "in_progress").locator("[data-lane]"));
    await expect(lane(page, "in_progress").locator(`[data-task="${task.id}"]`)).toBeVisible();
    await expect(page.locator("[data-status-region]")).toContainText("Moved “Engage Okafor LLP for the Q3 audit” to In progress");
    await expect(lane(page, "todo").locator(`[data-task="${task.id}"]`)).toHaveCount(0);

    await lane(page, "in_progress").locator(`[data-task="${task.id}"]`).dragTo(lane(page, "done").locator("[data-lane]"));
    await expect(lane(page, "done").locator(`[data-task="${task.id}"]`)).toBeVisible();
  });

  await test.step("an agent splits the task into subtasks and adds a link, and the board shows both", async () => {
    await asAgent(token, async (agent) => {
      await agent.call("capture_tasks", { tasks: [{ title: "Send Okafor the engagement letter", parentTaskId: task.id, status: "todo" }] });
      await agent.call("update_task", { taskId: task.id, addLinks: [{ url: CHAT, title: "This chat", kind: "conversation" }] });
    });
    await page.reload();
    const parent = lane(page, "done").locator(`[data-task="${task.id}"]`);
    await expect(parent).toContainText("0 of 1 subtasks done");
    await expect(parent.getByRole("link", { name: /^This chat/ })).toHaveAttribute("href", CHAT);
    await expect(parent.getByRole("link", { name: /^Quotes email/ })).toHaveAttribute("href", MAIL);
    await expect(lane(page, "todo").getByText("Subtask of Engage Okafor LLP for the Q3 audit")).toBeVisible();
  });

  await test.step("the agent sees the edit and the completion", async () => {
    await asAgent(token, async (agent) => {
      const { tasks } = await agent.call<{ tasks: (Task & { status: string; priority: string })[] }>("list_tasks", { status: "done" });
      expect(tasks).toEqual([expect.objectContaining({ id: task.id, title: "Engage Okafor LLP for the Q3 audit", priority: "high" })]);
    });
  });
});
