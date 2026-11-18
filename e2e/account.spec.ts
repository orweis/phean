import { expect, test, type Page } from "@playwright/test";

import { signUp, newPerson, type Person } from "./support/accounts";
import { expectAccessible } from "./support/checks";
import { totpCode } from "./support/totp";

const statusRegion = (page: Page) => page.locator("[data-status-region]");
const twoFactorCard = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Two-factor authentication" }) });

async function openAccount(page: Page, person: Person) {
  await page.getByRole("banner").locator("summary").filter({ hasText: person.name }).click();
  await page.getByRole("link", { name: "Account and security" }).click();
  await expect(page).toHaveURL("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
}

async function signOut(page: Page, person: Person) {
  await page.getByRole("banner").locator("summary").filter({ hasText: person.name }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
}

async function signInWithPassword(page: Page, person: Person, next = "/account") {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * A person turns on two-factor with an authenticator app, signs in with a code and then with a
 * backup code, changes their password, and turns two-factor off again.
 */
test("a person turns on two-factor, signs in with a code or a backup code, and turns it off", async ({ page }) => {
  test.slow();
  const person = newPerson("Robin Reyes");
  await signUp(page, person);
  let uri = "";
  let backupCodes: string[] = [];

  await test.step("the account page lists the password as a way in", async () => {
    await openAccount(page, person);
    const methods = page.getByRole("list", { name: "Sign-in methods" });
    await expect(methods.getByRole("listitem").filter({ hasText: "Password" })).toContainText("Connected");
    await expect(twoFactorCard(page)).toContainText("Off");
    await expect(methods.getByRole("listitem").filter({ hasText: "GitHub" })).toContainText("Not connected");
    // The only way in can't be removed.
    await methods.locator('summary[aria-label="More actions for your password"]').click();
    await expect(page.getByRole("button", { name: "Remove password" })).toBeDisabled();
    await page.keyboard.press("Escape");
  });

  await test.step("connecting GitHub hands off to GitHub, and a failed connection comes back with the reason", async () => {
    // Stop at the provider: the spec checks the hand-off, not GitHub itself.
    let authorize: URL | null = null;
    await page.route("https://github.com/**", async (route) => {
      authorize = new URL(route.request().url());
      await route.fulfill({ status: 200, body: "GitHub" });
    });
    await page.getByRole("button", { name: "Connect GitHub" }).click();
    await expect.poll(() => authorize?.pathname).toBe("/login/oauth/authorize");
    expect(authorize!.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/github$/);
    await page.waitForURL(/^https:\/\/github\.com\//);
    await page.goto("/account?error=account_already_linked_to_different_user");
    await expect(page.getByRole("alert").filter({ hasText: "already signs in" })).toHaveText("That account already signs in to another Phean account.");
  });

  await test.step("turning on two-factor: password, scan, code, backup codes", async () => {
    await twoFactorCard(page).getByRole("button", { name: "Turn on" }).click();
    await page.getByLabel("Your password", { exact: true }).fill(person.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("img", { name: "QR code to add Phean to your authenticator app" })).toBeVisible();
    await expectAccessible(page);
    // What a person would type into their app instead of scanning.
    const key = (await page.locator("[data-secret]").innerText()).replace(/\s+/g, "");
    uri = `otpauth://totp/Phean:${encodeURIComponent(person.email)}?secret=${key}&issuer=Phean`;
    await page.getByLabel("Authentication code").fill(totpCode(uri));
    await page.getByRole("button", { name: "Verify and turn on" }).click();
    await expect(page.getByText("Two-factor is on. Save your backup codes.")).toBeVisible();
    backupCodes = await page.getByRole("list", { name: "Backup codes" }).getByRole("listitem").allInnerTexts();
    expect(backupCodes).toHaveLength(10);
    await page.getByRole("button", { name: "I’ve saved them" }).click();
    await expect(statusRegion(page)).toContainText("Turned on two-factor");
    await expect(twoFactorCard(page)).toContainText("On");
  });

  await test.step("signing in asks for the code, refuses a wrong one, and takes the right one", async () => {
    await signOut(page, person);
    await signInWithPassword(page, person);
    await expect(page).toHaveURL("/sign-in/two-factor?next=%2Faccount");
    await expectAccessible(page);
    await page.getByLabel("Authentication code").fill(totpCode(uri, { stepOffset: 4 }));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That code didn't match" })).toBeVisible();
    await page.getByLabel("Authentication code").fill(totpCode(uri));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL("/account");
  });

  await test.step("a backup code signs in once", async () => {
    await signOut(page, person);
    await signInWithPassword(page, person);
    await expect(page).toHaveURL(/\/sign-in\/two-factor/);
    await page.getByRole("button", { name: "Use a backup code instead" }).click();
    await page.getByLabel("Backup code").fill(backupCodes[0]!);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL("/account");
  });

  await test.step("changing the password", async () => {
    const methods = page.getByRole("list", { name: "Sign-in methods" });
    await methods.locator("summary").filter({ hasText: "Change password" }).click();
    const panel = page.getByRole("group", { name: "Change your password" });
    await panel.getByLabel("Current password").fill(person.password);
    await panel.getByLabel("New password").fill("staple-battery-horse-correct");
    await panel.getByRole("button", { name: "Change password" }).click();
    await expect(statusRegion(page)).toContainText("Changed your password");
    person.password = "staple-battery-horse-correct";
  });

  await test.step("turning two-factor off needs the password and a confirmation", async () => {
    await twoFactorCard(page).locator("summary").filter({ hasText: "Turn off" }).click();
    const panel = page.getByRole("group", { name: "Turn off two-factor" });
    await panel.getByLabel("Your password", { exact: true }).fill(person.password);
    page.once("dialog", (dialog) => void dialog.accept());
    await panel.getByRole("button", { name: "Turn off" }).click();
    await expect(statusRegion(page)).toContainText("Turned off two-factor");
    await expect(twoFactorCard(page)).toContainText("Off");
  });
});
