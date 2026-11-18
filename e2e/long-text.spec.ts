import { expect, test, type Page } from "@playwright/test";

import { newWorkspace } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { expectNothingCutOff } from "./support/checks";
import { openTab } from "./support/navigation";

interface Task {
  id: string;
}

/** Options as long as agents write them: a sentence with a repo name, and a name with no spaces to break at. */
const LONG_OPTIONS = [
  "I'll set them myself now, then tell Ad Manager to verify",
  "Give Claude access: a Vercel token in the cloud env, api.vercel.com allowlisted, and permitio/next-website added to this scheduled task",
  "GOOGLE_ADS_CONVERSION_ACTION_ID_AND_DATA_MANAGER_OAUTH_CLIENT_SECRET",
  "Hold; not a priority now",
];

/** Every option of every request, and every answered option, stays inside the card it belongs to. */
async function expectOptionsInsideCards(page: Page) {
  const escapes = await page.evaluate(() =>
    [...document.querySelectorAll("button[data-option], label:has(> input[data-option]), [aria-label^='Options offered'] li")].flatMap((option) => {
      const card = option.closest("section");
      if (!card) return [];
      const box = option.getBoundingClientRect();
      const bounds = card.getBoundingClientRect();
      return box.width > 0 && (box.right > bounds.right + 1 || box.left < bounds.left - 1) ? [option.textContent?.trim().slice(0, 40)] : [];
    }),
  );
  expect(escapes, "options running out of their card").toEqual([]);
}

/** Agents write long answers; a decision's options wrap inside their card wherever they are shown. */
test("long options wrap inside their card on the overview and the Decisions page", async ({ page }) => {
  const { slug } = await newWorkspace(page, "Acme");
  await openTab(page, slug, "Agents");
  const token = await issueToken(page, "Claude Content Agent");
  await asAgent(token, async (agent) => {
    const { created } = await agent.call<{ created: Task[] }>("capture_tasks", {
      tasks: [{ title: "Set SFS conversion Vercel env var so form submits can record" }, { title: "Announce the conversion tracking launch" }],
    });
    const [envVars, announce] = created as [Task, Task];
    await agent.call("request_input", {
      taskId: envVars.id,
      kind: "decision",
      question: "I can't reach the Vercel team from my scheduled runs. How should the SFS conversion env vars get set?",
      options: LONG_OPTIONS,
    });
    await agent.call("request_input", {
      taskId: announce.id,
      kind: "decision",
      question: "Where should the launch be announced? Pick any that apply.",
      options: LONG_OPTIONS,
      multiple: true,
    });
  });

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 375, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of [`/w/${slug}`, `/w/${slug}/decisions`]) {
      await page.goto(path);
      await expect(page.locator("[data-option]").first()).toBeVisible();
      await expectOptionsInsideCards(page);
      await expectNothingCutOff(page);
    }
  }
});
