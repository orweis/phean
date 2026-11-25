import { expect, test } from "@playwright/test";

import { DEMO_USER } from "../scripts/demo-account";
import { newWorkspace } from "./support/accounts";
import { DEMO_SESSION } from "./support/env";
import { card, popover } from "./support/locators";

/**
 * An owner deletes their own new workspace from Settings' Danger zone, after a member (the seeded
 * demo account, in a browser of its own) finds no Danger zone there. One test: sign-ups are rate limited.
 */
test("an owner deletes their workspace, and a member never sees how", async ({ page, browser }) => {
  test.slow();
  const workspace = await newWorkspace(page, "Doomed");
  const { slug, name } = workspace;

  await test.step("the owner invites the demo account as a member, who accepts", async () => {
    await page.goto(`/w/${slug}/members`);
    const invite = popover(card(page, "People"), "Invite");
    await invite.locator("summary").click();
    const form = invite.locator(":scope > div");
    await form.getByRole("textbox", { name: "Email" }).fill(DEMO_USER.email);
    await form.getByRole("combobox", { name: "Role" }).selectOption("member");
    await form.getByRole("button", { name: "Invite" }).click();
    const link = (await invite.locator("code").textContent())!.trim();

    const colleague = await browser.newContext({ storageState: DEMO_SESSION });
    try {
      const theirs = await colleague.newPage();
      await theirs.goto(link);
      await theirs.getByRole("button", { name: "Accept invitation" }).click();
      await expect(theirs).toHaveURL(`/w/${slug}`);
      await theirs.goto(`/w/${slug}/settings`);
      await expect(card(theirs, "Board stages")).toBeVisible();
      await expect(card(theirs, "Danger zone")).toHaveCount(0);
      await expect(theirs.getByText("Delete workspace")).toHaveCount(0);
    } finally {
      await colleague.close();
    }
  });

  await test.step("the Danger zone counts what goes with the workspace", async () => {
    await page.goto(`/w/${slug}/settings`);
    const danger = card(page, "Danger zone");
    await expect(danger).toBeVisible();
    for (const count of ["0 tasks", "0 goals", "0 decisions", "0 documents", "0 memories", "0 agents", "0 pipelines", "0 webhooks", "2 members"]) {
      await expect(danger.getByRole("listitem").filter({ hasText: count })).toBeVisible();
    }
  });

  await test.step("the delete button waits for the exact name, and the server for the password", async () => {
    const panel = popover(page, "Delete workspace");
    await panel.locator("summary").click();
    const confirm = panel.getByLabel(`Type “${name}” to confirm`);
    const remove = panel.getByRole("button", { name: "Delete this workspace" });
    await expect(confirm).toBeFocused();
    await expect(remove).toBeDisabled();
    await confirm.fill(name.toLowerCase().slice(0, -1));
    await expect(remove).toBeDisabled();
    await confirm.fill(name);
    await expect(remove).toBeEnabled();

    await panel.getByLabel("Your password").fill("not-my-password");
    await remove.click();
    await expect(panel.getByRole("alert")).toHaveText("That password is not right.");
    await expect(page).toHaveURL(`/w/${slug}/settings`);

    await panel.getByLabel("Your password").fill(workspace.owner.password);
    await remove.click();
    await expect(page).toHaveURL("/workspaces");
    await expect(page.getByRole("status").filter({ hasText: `Deleted workspace “${name}”` })).toBeVisible();
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  });

  await test.step("the notice shows once, the old URL is a 404, and the app no longer reopens it", async () => {
    await page.reload();
    await expect(page.getByText(`Deleted workspace “${name}”`)).toHaveCount(0);
    expect((await page.goto(`/w/${slug}/settings`))?.status()).toBe(404);
    expect((await page.goto(`/w/${slug}`))?.status()).toBe(404);
    await page.goto("/w");
    await expect(page).toHaveURL("/workspaces");
  });

  await test.step("the member's link to it is a 404 too", async () => {
    const colleague = await browser.newContext({ storageState: DEMO_SESSION });
    try {
      const theirs = await colleague.newPage();
      expect((await theirs.goto(`/w/${slug}`))?.status()).toBe(404);
      await theirs.goto("/workspaces");
      await expect(theirs.getByRole("link", { name })).toHaveCount(0);
    } finally {
      await colleague.close();
    }
  });
});
