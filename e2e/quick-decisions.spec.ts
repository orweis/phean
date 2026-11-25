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
  // A card that has just arrived takes no input for a moment; a person's finger would be slower anyway.
  await expect(page.locator("[data-arriving]")).toHaveCount(0);
  const box = (await card.getByRole("heading", { level: 2 }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + 4, { steps: 12 });
  if (!hold) await page.mouse.up();
}

/** How far the card is drawn from its place, sideways, in CSS pixels. */
const translateX = (card: Locator) => card.evaluate((element) => Math.round(new DOMMatrix(getComputedStyle(element).transform).e));

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
      await expect(page.locator("[data-progress-count]")).toHaveText("1 of 4 requests");
      await expect(page.getByRole("img", { name: "Request 1 of 4: 0 answered, 3 after this one" })).toBeVisible();
      // A focused flow: no workspace header or tab rail, only its own bar with the way out.
      await expect(page.getByRole("banner")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Close Quick Decisions" })).toHaveAttribute("href", `/w/${slug}/decisions`);
    });

    const first = cardOf(page, LAUNCH);
    await test.step("the card shows who asked, the start of the context, the files and the recommended answer", async () => {
      await expect(first).toContainText("Launch bot");
      await expect(first).toContainText("Decision");
      await expect(first.getByRole("button", { name: /^Send.*Recommended/ })).toBeVisible();
      await expect(first.getByRole("list", { name: "Files" }).getByRole("link")).toHaveCount(2);
      await expect(page.getByRole("group", { name: "Quick actions" }).getByRole("button", { name: "Send recommended: “Send”" })).toBeEnabled();
      // The links the agent left are on the card's face, each a thumb's size.
      const link = first.getByRole("list", { name: "Links" }).getByRole("link", { name: /^This chat/ });
      await expect(link).toHaveAttribute("target", "_blank");
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    });

    await test.step("the full context, a file and back, one tap each", async () => {
      await first.getByRole("link", { name: "Read full context" }).click();
      await expect(page).toHaveURL(/view=context/);
      await expect(page.getByRole("heading", { level: 1, name: LAUNCH })).toBeVisible();
      await expect(page.getByText("Launch bot asks")).toBeVisible();
      await expect(page.getByText("Open rate on the last beta email was 61%.")).toBeVisible();
      // Every option is in view in the dock, none behind a sideways scroll.
      const dock = page.locator("[data-answer-dock]");
      await expect(dock.getByRole("button", { name: "Hold" })).toBeInViewport({ ratio: 1 });
      await expect(dock.getByRole("button", { name: /^Send/ })).toBeInViewport({ ratio: 1 });
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

    await test.step("the card follows the finger one to one either way, and the answer behind it shows from half way", async () => {
      for (const dx of [70, -70]) {
        const start = (await first.getByRole("heading", { level: 2 }).boundingBox())!;
        await swipe(page, first, dx, { hold: true });
        await expect.poll(() => translateX(first)).toBe(dx);
        const label = page.locator(`[data-swipe-hint=${dx > 0 ? "send" : "snooze"}] [data-swipe-label]`);
        await expect(label).toContainText(dx > 0 ? "Recommended:“Send”" : "SnoozeTo the back");
        await expect.poll(() => label.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0.5);
        // Back to where it started: short of the threshold, nothing happens.
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 4, { steps: 6 });
        await page.mouse.up();
        await expect.poll(() => translateX(first)).toBe(0);
      }
    });

    await test.step("swiping right sends the recommended answer, and Undo takes it back", async () => {
      await swipe(page, first, 160, { hold: true });
      await expect(page.locator("[data-swipe=send]")).toContainText("Recommended:“Send”");
      await expect(page.locator("[data-swipe-hint=send]")).toHaveAttribute("data-armed");
      await page.mouse.up();
      await expect(status).toContainText("Sent “Send” to Launch bot");
      await expect(cardOf(page, COURIER)).toBeVisible();
      await expect(page.locator("[data-progress-count]")).toHaveText("2 of 4 requests");
      // The notice sits above the bar, never over its buttons.
      const notice = (await status.locator("[data-notice]").boundingBox())!;
      const bar = (await page.getByRole("group", { name: "Quick actions" }).boundingBox())!;
      expect(notice.y + notice.height).toBeLessThanOrEqual(bar.y);
      await status.getByRole("button", { name: "Undo" }).click();
      await expect(status).toContainText("Launch bot's question is open again.");
      await expect(first).toBeVisible();
      await expect(page.locator("[data-progress-count]")).toHaveText("1 of 4 requests");
    });

    await test.step("a short drag springs back; tapping an option answers at once", async () => {
      await swipe(page, first, 60);
      await expect(first).toBeVisible();
      await first.getByRole("button", { name: "Hold" }).click();
      await expect(status).toContainText("Sent “Hold” to Launch bot");
      // Focus moves to the question of the card that took its place.
      await expect(cardOf(page, COURIER).getByRole("heading", { level: 2 })).toBeFocused();
    });

    await test.step("with no recommendation a swipe right offers the first option, named as such; Snooze sends it to the back", async () => {
      const card = cardOf(page, COURIER);
      await expect(page.getByRole("group", { name: "Quick actions" }).getByRole("button", { name: "Send first option: “DHL”" })).toBeEnabled();
      const box = (await card.getByRole("heading", { level: 2 }).boundingBox())!;
      await swipe(page, card, 160, { hold: true });
      await expect(page.locator("[data-swipe-hint=send] [data-swipe-label]")).toContainText("First option:“DHL”");
      // Back where it started, short of the threshold: nothing is sent.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 4, { steps: 8 });
      await page.mouse.up();
      await expect(card).toBeVisible();
      await page.getByRole("group", { name: "Quick actions" }).getByRole("button", { name: "Snooze" }).click();
      await expect(status).toContainText(`Snoozed “${COURIER}”`);
      await expect(cardOf(page, CHANNELS)).toBeVisible();
    });

    await test.step("several picks: the recommendations start ticked, and the bar's one Send counts and names the picks", async () => {
      const card = cardOf(page, CHANNELS);
      const bar = page.getByRole("group", { name: "Quick actions" });
      await expect(card.getByRole("checkbox", { name: /Blog.*Recommended/ })).toBeChecked();
      await expect(card.getByRole("checkbox", { name: /Changelog/ })).toBeChecked();
      await expect(card.getByRole("checkbox", { name: /Newsletter/ })).not.toBeChecked();
      await expect(card.getByRole("button", { name: /^Send/ })).toHaveCount(0);
      await expect(bar.getByRole("button", { name: "Send 2 picks: Blog + Changelog" })).toBeEnabled();
      await card.getByRole("checkbox", { name: /Changelog/ }).uncheck();
      await card.getByRole("checkbox", { name: /Blog/ }).uncheck();
      await expect(bar.getByRole("button", { name: "Pick at least one" })).toBeDisabled();
      await card.getByRole("checkbox", { name: /Blog/ }).check();
      await card.getByRole("checkbox", { name: /Newsletter/ }).check();
      await bar.getByRole("button", { name: "Send 2 picks: Blog + Newsletter" }).click();
      await expect(status).toContainText("Sent “Blog + Newsletter” to Launch bot");
    });

    await test.step("a question with no options is answered in the field on the card, and the bar has nothing to send", async () => {
      const card = cardOf(page, BUDGET);
      const field = card.getByLabel("Your answer");
      await expect(field).toBeVisible();
      await expect(page.getByRole("group", { name: "Quick actions" }).getByRole("button")).toHaveText(["Snooze"]);
      await expect(card.getByRole("button", { name: "Send answer" })).toBeDisabled();
      await expectAccessible(page);
      await card.getByRole("button", { name: "Check with" }).click();
      await expect(field).toHaveValue("Check with ");
      await expect(field).toBeFocused();
      await field.fill("Marketing: MKT-204");
      await card.getByRole("button", { name: "Send answer" }).click();
      await expect(status).toContainText("Sent “Marketing: MKT-204” to Launch bot");
    });

    await test.step("with only the snoozed one left the queue rests; shown again, a swipe left rests it again, a tap answers it", async () => {
      const card = cardOf(page, COURIER);
      const rest = page.locator("[data-quick-snoozed]");
      await expect(rest.getByRole("heading", { level: 2 })).toHaveText("1 snoozed, nothing else waiting");
      await expect(rest.getByRole("heading", { level: 2 })).toBeFocused();
      await expect(rest.getByRole("link", { name: "Back to Decisions" })).toHaveAttribute("href", `/w/${slug}/decisions`);
      await rest.getByRole("button", { name: "Show snoozed again" }).click();
      await expect(card).toBeVisible();
      await expect(page.locator("[data-progress-count]")).toHaveText("4 of 4 requests");
      await swipe(page, card, -180);
      await expect(status).toContainText(`Snoozed “${COURIER}”`);
      await expect(rest).toBeVisible();
      await rest.getByRole("button", { name: "Show snoozed again" }).click();
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
      // The tab keeps only ids and a short label, never the question or the answer in full.
      const stored = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith("phean-quick-answered:")));
      expect(stored).toHaveLength(1);
      expect(stored[0]![1]).not.toContain(CONTEXT.slice(0, 40));
      expect(stored[0]![1]).not.toContain("Pick any that apply");
      // After a reload, Undo still brings the card back.
      await page.reload();
      await list.getByRole("button", { name: /^Undo “DHL”/ }).click();
      await expect(status).toContainText("The question is open again.");
      await cardOf(page, COURIER).getByRole("button", { name: "UPS" }).click();
      await expect(done).toContainText("4 answered.");
      await expect(done.getByRole("link", { name: "Back to Decisions" })).toHaveAttribute("href", `/w/${slug}/decisions`);
      // Closing and coming back carries on from today's progress rather than starting over.
      await page.getByRole("link", { name: "Close Quick Decisions" }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${slug}/decisions$`));
      await page.goto(`/w/${slug}/decisions/quick`);
      await expect(done).toContainText("4 answered.");
      await expect(page.locator("[data-progress-count]")).toHaveText("4 of 4 requests");
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

test.describe("Quick Decisions guards", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test("pipeline decisions come first without Undo; keys, double taps, stale requests and stray files are handled", async ({ page }) => {
    test.slow();
    const { slug, owner } = await newWorkspace(page, "Guarded");
    await openTab(page, slug, "Agents");
    const token = await issueToken(page, "Guard bot");
    const status = page.locator("[data-status-region]");

    const asked = await asAgent(token, async (agent) => {
      await agent.call("define_pipeline", {
        name: "Release notes",
        kind: "adhoc",
        definition: {
          stops: [
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
      });
      const { created } = await agent.call<{ created: Task[] }>("capture_tasks", {
        tasks: ["Pick the venue", "Pick the caterer", "Pick the band", "Pick the date", "Pick the theme"].map((title) => ({ title, status: "todo" })),
      });
      const [venue, caterer, band, date, theme] = created as [Task, Task, Task, Task, Task];
      const { document } = await agent.call<{ document: { id: string } }>("attach_document", { taskId: theme.id, title: "Theme moodboard", format: "markdown", content: "# Secret theme" });
      const ask = (task: Task, question: string, options: string[], recommended?: number) =>
        agent.call<{ task: { inputRequest: { id: string } } }>("request_input", { taskId: task.id, kind: "decision", question, options, ...(recommended !== undefined && { recommended }) });
      await ask(venue, "Which venue?", ["Hall", "Barn"], 1);
      await ask(caterer, "Which caterer?", ["Ada's", "Bo's"], 0);
      const bandAsk = await ask(band, "Which band?", ["Jazz", "Rock"]);
      await ask(date, "Which date?", ["May", "June"]);
      const themeAsk = await ask(theme, "Which theme?", ["Retro", "Space"]);
      return { venue, bandRequest: bandAsk.task.inputRequest.id, themeRequest: themeAsk.task.inputRequest.id, moodboard: document.id };
    });

    const settled = () => expect(page.locator("[data-arriving]")).toHaveCount(0);

    await test.step("the pipeline's decision comes first and cannot be taken back", async () => {
      await page.goto(`/w/${slug}/decisions/quick`);
      const card = page.getByRole("article", { name: "Publish these release notes?" });
      await expect(card).toContainText("Release notes #1 · Review");
      await expect(card).toContainText("Stop 1 of 1");
      await expect(card).toContainText("Defaults to “Hold” in 10 hours");
      await card.getByRole("button", { name: "Publish" }).click();
      await expect(status).toContainText("Sent “Publish” to Release notes #1; the run has it now, so it cannot be taken back");
      await expect(status.getByRole("button", { name: "Undo" })).toHaveCount(0);
    });

    await test.step("a double tap answers one card, not the one that replaces it", async () => {
      const venue = page.getByRole("article", { name: "Which venue?" });
      await settled();
      await venue.getByRole("button", { name: /^Barn/ }).dblclick();
      await expect(status).toContainText("Sent “Barn” to Guard bot");
      await expect(page.getByRole("article", { name: "Which caterer?" })).toBeVisible();
      await page.waitForTimeout(600);
      await expect(page.getByRole("article", { name: "Which caterer?" })).toBeVisible();
      await expect(page.locator("[data-progress-count]")).toHaveText("3 of 6 requests");
      // Take it back, so the agent can close the venue question itself below.
      await status.getByRole("button", { name: "Undo" }).click();
      await expect(status).toContainText("Guard bot's question is open again.");
      await expect(page.getByRole("article", { name: "Which venue?" })).toBeVisible();
    });

    await test.step("a request answered elsewhere leaves with a word instead of an error", async () => {
      await asAgent(token, (agent) => agent.call("resolve_input", { taskId: asked.venue.id }));
      await settled();
      await page.getByRole("article", { name: "Which venue?" }).getByRole("button", { name: "Hall" }).click();
      await expect(status).toContainText("Already answered elsewhere: “Which venue?”");
      await expect(page.getByRole("article", { name: "Which caterer?" })).toBeVisible();
      await expect(page.getByRole("article", { name: "Which venue?" })).toHaveCount(0);
    });

    await test.step("→ sends the recommended answer, ← snoozes, and a number picks an option", async () => {
      await settled();
      await page.keyboard.press("ArrowRight");
      await expect(status).toContainText("Sent “Ada's” to Guard bot");
      const band = page.getByRole("article", { name: "Which band?" });
      await expect(band).toBeVisible();
      await settled();
      // Nothing is recommended on this one, so → would send its first option; ← snoozes it instead.
      await page.keyboard.press("ArrowLeft");
      await expect(status).toContainText("Snoozed “Which band?”");
      await expect(page.getByRole("article", { name: "Which date?" })).toBeVisible();
      await settled();
      await page.keyboard.press("2");
      await expect(status).toContainText("Sent “June” to Guard bot");
      await expect(page.getByRole("article", { name: "Which theme?" })).toBeVisible();
    });

    await test.step("a file link pointing at another task's document shows nothing of it", async () => {
      // The band's request is still waiting (snoozed); the moodboard is on the theme's task.
      await page.goto(`/w/${slug}/decisions/quick?request=${asked.bandRequest}&view=file&file=${asked.moodboard}`);
      await expect(page.getByRole("heading", { level: 1, name: "Quick Decisions" })).toBeVisible();
      await expect(page.getByText("Secret theme")).toHaveCount(0);
      await expect(page.locator("[data-quick-file]")).toHaveCount(0);
      // The same file through its own request opens.
      await page.goto(`/w/${slug}/decisions/quick?request=${asked.themeRequest}&view=file&file=${asked.moodboard}`);
      await expect(page.locator("[data-quick-file]")).toContainText("Secret theme");
    });
  });
});
