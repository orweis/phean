import { expect, test, type Locator, type Page } from "@playwright/test";

import { DONE_TITLES } from "../src/lib/quick-decisions";
import { newWorkspace } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { expectAccessible, expectNothingCutOff } from "./support/checks";
import { openTab } from "./support/navigation";

interface Task {
  id: string;
  title: string;
}

interface Answer {
  taskId: string;
  answer: string;
  chosenOptions: string[];
}

const LAUNCH = "Send the launch email to the beta list now, or hold it until the pricing page is live?";
const COURIER = "Which courier takes the signed contracts?";
const CHANNELS = "Which channels should announce the launch? Pick any that apply.";
const BUDGET = "Which budget code do the offsite flights go to?";
const CONTEXT = [
  "The draft is approved and the list is clean: 1,240 beta users, 3 bounced addresses removed.",
  "Pricing goes live on Thursday. Sending now gets us two extra days of feedback; holding keeps the email and the page in step.",
  "Open rate on the last beta email was 61%.",
  "I recommend sending now: the email does not quote prices.",
].join("\n");

/** The card on screen, named by its question. */
const cardOf = (page: Page, question: string) => page.getByRole("article", { name: question });

/** Drags a card sideways by its question, as a finger would, and lets go unless asked to hold. */
async function swipe(page: Page, card: Locator, dx: number, { hold = false } = {}) {
  const box = (await card.getByRole("heading", { level: 2 }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + 4, { steps: 12 });
  if (!hold) await page.mouse.up();
}

test.describe("Quick Decisions on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("a person works through the queue a card at a time: taps, swipes, picks, writes, snoozes, reads and undoes", async ({ page }) => {
    test.slow();
    const { slug } = await newWorkspace(page, "Quickly");
    await openTab(page, slug, "Agents");
    const token = await issueToken(page, "Launch bot");

    const [launch, courier, channels, budget] = await asAgent(token, async (agent) => {
      const { created } = await agent.call<{ created: Task[] }>("capture_tasks", {
        tasks: [
          { title: "Send the launch email", status: "todo" },
          { title: "Ship the signed contracts", status: "todo" },
          { title: "Announce the launch", status: "todo" },
          { title: "Book the offsite flights", status: "todo" },
        ],
      });
      const [one, two, three, four] = created as [Task, Task, Task, Task];
      await agent.call("attach_document", { taskId: one.id, title: "Launch email draft", format: "markdown", content: "# Big news\n\nPhean is **live** for everyone." });
      await agent.call("attach_document", { taskId: one.id, title: "Email preview", format: "html", content: "<h1>Big news</h1>" });
      await agent.call("request_input", {
        taskId: one.id,
        kind: "decision",
        question: LAUNCH,
        context: CONTEXT,
        options: ["Hold", "Send"],
        recommended: 1,
        links: [{ url: "https://claude.ai/chat/5d0c2e7a-91b4-4a8e-b1f3-2c6e8a4d7f10", title: "This chat", kind: "conversation" }],
      });
      await agent.call("request_input", { taskId: two.id, kind: "decision", question: COURIER, options: ["DHL", "UPS"] });
      await agent.call("request_input", { taskId: three.id, kind: "decision", question: CHANNELS, options: ["Blog", "Newsletter", "Changelog"], multiple: true, recommended: [0, 2] });
      await agent.call("request_input", { taskId: four.id, kind: "question", question: BUDGET });
      return [one, two, three, four] as const;
    });
    const status = page.locator("[data-status-region]");

    await test.step("the Decisions page leads with Quick Decisions on a phone", async () => {
      await page.goto(`/w/${slug}/decisions`);
      const start = page.locator("[data-quick-start=phone]");
      await expect(start).toContainText("4 requests waiting");
      await start.getByRole("link", { name: "Start" }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${slug}/decisions/quick\\?from=phone$`));
      await expect(page.getByRole("heading", { level: 1, name: "Quick Decisions" })).toBeVisible();
      await expect(page.locator("[data-progress-count]")).toHaveText("1 of 4");
      await expect(page.getByRole("img", { name: "Decision 1 of 4: 0 answered, 3 after this one" })).toBeVisible();
    });

    const first = cardOf(page, LAUNCH);
    await test.step("the card shows who asked, the start of the context, the files and the recommended answer", async () => {
      await expect(first).toContainText("Launch bot");
      await expect(first).toContainText("Decision");
      await expect(first.getByRole("button", { name: /^Send.*Recommended/ })).toBeVisible();
      await expect(first.getByRole("list", { name: "Files" }).getByRole("link")).toHaveCount(2);
      await expect(page.getByRole("group", { name: "Quick actions" }).getByRole("button", { name: "Send “Send”" })).toBeEnabled();
    });

    await test.step("the full context, a file and back, one tap each", async () => {
      await first.getByRole("link", { name: "Read full context" }).click();
      await expect(page).toHaveURL(/view=context/);
      await expect(page.getByRole("heading", { level: 1, name: LAUNCH })).toBeVisible();
      await expect(page.getByText("Launch bot asks")).toBeVisible();
      await expect(page.getByText("Open rate on the last beta email was 61%.")).toBeVisible();
      await expectAccessible(page);
      await expectNothingCutOff(page);
      const tabs = page.getByRole("navigation", { name: "Context, files and links" });
      await tabs.getByRole("link", { name: "Links (1)" }).click();
      await expect(page.getByRole("link", { name: /^This chat/ })).toHaveAttribute("target", "_blank");
      await tabs.getByRole("link", { name: "Files (2)" }).click();
      await page.getByRole("list", { name: "Files" }).getByRole("link", { name: /Launch email draft/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Launch email draft" })).toBeVisible();
      await expect(page.getByText("Markdown · 1 of 2")).toBeVisible();
      await expect(page.locator("[data-quick-file] strong")).toHaveText("live");
      await expectAccessible(page);
      await expectNothingCutOff(page);
      await page.getByRole("link", { name: "Next file" }).click();
      await expect(page.getByText("HTML · 2 of 2")).toBeVisible();
      // HTML is shown as its source, never rendered.
      await expect(page.locator("[data-quick-file] pre")).toHaveText("<h1>Big news</h1>");
      await page.getByRole("link", { name: "Files" }).click();
      await expect(page.getByRole("link", { name: "Files (2)" })).toHaveAttribute("aria-current", "page");
      await page.getByRole("link", { name: "Decision", exact: true }).click();
      await expect(first).toBeVisible();
      // The file viewer's own way back.
      await first.getByRole("list", { name: "Files" }).getByRole("link", { name: /Email preview/ }).click();
      await page.getByRole("link", { name: "Back to the decision" }).click();
      await expect(first).toBeVisible();
    });

    await test.step("swiping right sends the recommended answer, and Undo takes it back", async () => {
      await swipe(page, first, 160, { hold: true });
      await expect(page.locator("[data-swipe=send]")).toContainText("Send “Send”");
      await page.mouse.up();
      await expect(status).toContainText("Sent “Send” to Launch bot");
      await expect(cardOf(page, COURIER)).toBeVisible();
      await expect(page.locator("[data-progress-count]")).toHaveText("2 of 4");
      await status.getByRole("button", { name: "Undo" }).click();
      await expect(status).toContainText("Launch bot's question is open again.");
      await expect(first).toBeVisible();
      await expect(page.locator("[data-progress-count]")).toHaveText("1 of 4");
    });

    await test.step("a short drag springs back; tapping an option answers at once", async () => {
      await swipe(page, first, 60);
      await expect(first).toBeVisible();
      await first.getByRole("button", { name: "Hold" }).click();
      await expect(status).toContainText("Sent “Hold” to Launch bot");
      // Focus moves to the question of the card that took its place.
      await expect(cardOf(page, COURIER).getByRole("heading", { level: 2 })).toBeFocused();
    });

    await test.step("with no recommendation there is nothing to swipe right; Snooze sends it to the back", async () => {
      const card = cardOf(page, COURIER);
      await expect(page.getByRole("group", { name: "Quick actions" }).getByRole("button", { name: "No recommendation" })).toBeDisabled();
      await swipe(page, card, 200);
      await expect(card).toBeVisible();
      await page.getByRole("group", { name: "Quick actions" }).getByRole("button", { name: "Snooze" }).click();
      await expect(status).toContainText("Snoozed “Ship the signed contracts” to the back of the queue");
      await expect(cardOf(page, CHANNELS)).toBeVisible();
    });

    await test.step("several picks: the suggestions start ticked, and Send names the picks", async () => {
      const card = cardOf(page, CHANNELS);
      await expect(card.getByRole("checkbox", { name: /Blog/ })).toBeChecked();
      await expect(card.getByRole("checkbox", { name: /Changelog/ })).toBeChecked();
      await expect(card.getByRole("checkbox", { name: /Newsletter/ })).not.toBeChecked();
      await expect(card.getByRole("button", { name: "Send Blog + Changelog" })).toBeEnabled();
      await card.getByRole("checkbox", { name: /Changelog/ }).uncheck();
      await card.getByRole("checkbox", { name: /Blog/ }).uncheck();
      await expect(card.getByRole("button", { name: "Pick at least one" })).toBeDisabled();
      await card.getByRole("checkbox", { name: /Blog/ }).check();
      await card.getByRole("checkbox", { name: /Newsletter/ }).check();
      await card.getByRole("button", { name: "Send Blog + Newsletter" }).click();
      await expect(status).toContainText("Sent “Blog + Newsletter” to Launch bot");
    });

    await test.step("a question with no options is answered in the composer", async () => {
      const card = cardOf(page, BUDGET);
      await card.locator("summary", { hasText: "Answer" }).click();
      const sheet = page.getByRole("group", { name: "Answer Launch bot" });
      const field = sheet.getByLabel("Your answer");
      await expect(field).toBeFocused();
      await expect(sheet.getByRole("button", { name: "Send answer" })).toBeDisabled();
      await expectAccessible(page);
      await sheet.getByRole("button", { name: "Check with" }).click();
      await expect(field).toHaveValue("Check with ");
      await field.fill("Marketing: MKT-204");
      await sheet.getByRole("button", { name: "Send answer" }).click();
      await expect(status).toContainText("Sent “Marketing: MKT-204” to Launch bot");
    });

    await test.step("the snoozed one comes round again: a swipe left snoozes it, a tap answers it", async () => {
      const card = cardOf(page, COURIER);
      await expect(card).toBeVisible();
      await expect(page.locator("[data-progress-count]")).toHaveText("4 of 4");
      await swipe(page, card, -180);
      await expect(status).toContainText("Snoozed “Ship the signed contracts”");
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: "DHL" }).click();
      await expect(status).toContainText("Sent “DHL” to Launch bot");
    });

    await test.step("the done screen cheers, lists what was answered, and can still take one back", async () => {
      const done = page.locator("[data-quick-done]");
      await expect(done.getByRole("heading", { level: 2 })).toHaveText(new RegExp(DONE_TITLES.map((title) => title.replace(/[.!?()]/g, "\\$&")).join("|")));
      await expect(done.getByRole("heading", { level: 2 })).toBeFocused();
      await expect(done).toContainText("4 answered. Each agent has its answer now.");
      const list = done.getByRole("list", { name: "Answered in this session" });
      await expect(list.getByRole("listitem")).toHaveCount(4);
      await expectAccessible(page);
      await expectNothingCutOff(page);
      await list.getByRole("button", { name: `Undo the answer to ${COURIER}` }).click();
      await expect(status).toContainText("Launch bot's question is open again.");
      await cardOf(page, COURIER).getByRole("button", { name: "UPS" }).click();
      await expect(done).toContainText("4 answered.");
      await expect(done.getByRole("link", { name: "Back to Decisions" })).toHaveAttribute("href", `/w/${slug}/decisions`);
    });

    await test.step("each agent has exactly what was picked", async () => {
      const { answers } = await asAgent(token, (agent) => agent.call<{ answers: Answer[] }>("collect_answers", {}));
      const byTask = Object.fromEntries(answers.map((answer) => [answer.taskId, answer]));
      expect(byTask[launch.id]).toMatchObject({ answer: "Hold" });
      expect(byTask[courier.id]).toMatchObject({ answer: "UPS" });
      expect(byTask[channels.id]).toMatchObject({ chosenOptions: ["Blog", "Newsletter"] });
      expect(byTask[budget.id]).toMatchObject({ answer: "Marketing: MKT-204" });
    });
  });
});
