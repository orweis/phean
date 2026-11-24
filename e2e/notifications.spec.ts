import { expect, test } from "@playwright/test";

import { routes } from "../src/lib/routes";
import { newWorkspace } from "./support/accounts";
import { card } from "./support/locators";
import { openTab } from "./support/navigation";

test("a person mutes a workspace's notifications from Decisions, and finds the device card on their account", async ({ page }) => {
  const { slug, name } = await newWorkspace(page, "Initech");
  const status = page.locator("[data-status-region]");

  await test.step("the Decisions page mutes this workspace, with Undo", async () => {
    await openTab(page, slug, "Decisions");
    await page.getByRole("button", { name: "Mute notifications" }).click();
    await expect(status).toContainText(`Muted notifications from ${name}`);
    await expect(page.getByRole("button", { name: "Unmute notifications" })).toBeVisible();

    await status.getByRole("button", { name: "Undo" }).click();
    await expect(status).toContainText(`Notifications from ${name} are on again`);
    await expect(page.getByRole("button", { name: "Mute notifications" })).toBeVisible();
  });

  await test.step("and stays muted across a reload once muted", async () => {
    await page.getByRole("button", { name: "Mute notifications" }).click();
    await expect(page.getByRole("button", { name: "Unmute notifications" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Unmute notifications" })).toBeVisible();
    await page.getByRole("button", { name: "Unmute notifications" }).click();
    await expect(status).toContainText(`Notifications from ${name} are on again`);
  });

  await test.step("the account page has the device card, which says when the server sends no notifications", async () => {
    await page.goto(routes.account());
    const notifications = card(page, "Notifications on this device");
    await expect(notifications).toBeVisible();
    // The UI tests run without VAPID keys, so nothing can be turned on.
    await expect(notifications).toContainText("Notifications are not configured on this Phean server yet");
    await expect(notifications.getByRole("button", { name: "Notify me on this device" })).toHaveCount(0);
  });

  await test.step("the account page chooses what notifies the person, on every device, and keeps it across a reload", async () => {
    const choices = card(page, "What notifies you");
    await expect(choices).toContainText("You are never notified about what you did yourself");
    const resolved = choices.getByRole("checkbox", { name: /Answered or closed elsewhere/ });
    await expect(resolved).toBeChecked();
    await resolved.click();
    await expect(status).toContainText("Turned off “Answered or closed elsewhere”");
    await page.reload();
    await expect(card(page, "What notifies you").getByRole("checkbox", { name: /Answered or closed elsewhere/ })).not.toBeChecked();
    await expect(card(page, "What notifies you").getByRole("checkbox", { name: /New requests from agents/ })).toBeChecked();

    await card(page, "What notifies you").getByRole("checkbox", { name: /Answered or closed elsewhere/ }).click();
    await expect(status).toContainText("Turned on “Answered or closed elsewhere”");
  });
});
