import { expect, test } from "@playwright/test";

import { newWorkspace } from "./support/accounts";
import { card } from "./support/locators";

test("a person reads the morning digest and chooses when it is emailed", async ({ page }) => {
  const { slug } = await newWorkspace(page, "Hooli");
  const status = page.locator("[data-status-region]");

  await test.step("the overview leads to the digest, which is quiet in a new workspace", async () => {
    await page.getByRole("link", { name: "Morning digest" }).click();
    await expect(page).toHaveURL(`/w/${slug}/digest`);
    await expect(page.getByRole("heading", { level: 1, name: "Morning digest" })).toBeVisible();
    await expect(page.getByText("A quiet morning")).toBeVisible();
  });

  await test.step("they turn the email on at an hour of their own", async () => {
    const email = card(page, "Email it to me");
    await email.getByRole("combobox", { name: "Send it at" }).selectOption("7");
    await email.getByRole("button", { name: "Email me each morning" }).click();
    await expect(status).toContainText("Your morning digest is on");
    await expect(email).toContainText("Emailed each morning at 07:00");
  });

  await test.step("and stop it again", async () => {
    const email = card(page, "Email it to me");
    await email.getByRole("button", { name: "Stop emailing it" }).click();
    await expect(status).toContainText("Stopped your morning digest");
    await expect(email.getByRole("button", { name: "Email me each morning" })).toBeVisible();
  });
});
