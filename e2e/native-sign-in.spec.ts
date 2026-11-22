import { expect, test } from "@playwright/test";

import { newPerson, signUp } from "./support/accounts";
import { DESKTOP_STATE, desktopSignIn } from "./support/desktop-client";
import { BASE_URL } from "./support/env";

const EXPIRED = "This sign-in request has expired";

test("the desktop app signs in through the browser as the person who confirms it", async ({ page }) => {
  const person = newPerson("Desk Top");
  await signUp(page, person);

  await test.step("Sign in to Phean desktop hands the app a code it trades for a session of its own", async () => {
    const desktop = await desktopSignIn(BASE_URL);
    await page.goto(desktop.authorizePath);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Sign in to Phean desktop as ${person.name}?`);
    await expect(page.getByText(person.email)).toBeVisible();
    await expect(page.locator("[data-confirmation]")).toHaveText(desktop.confirmation);
    await page.getByRole("button", { name: "Sign in to Phean desktop" }).click();
    const callback = await desktop.callback;
    expect(callback.searchParams.get("state")).toBe(DESKTOP_STATE);
    const exchanged = await desktop.exchange(callback.searchParams.get("code")!);
    expect(exchanged.status).toBe(200);
    expect(await exchanged.json()).toMatchObject({ user: { email: person.email, name: person.name } });
    expect(exchanged.headers.getSetCookie().some((cookie) => cookie.includes("session_token="))).toBe(true);

    await test.step("the request is used up", async () => {
      await page.goto(desktop.authorizePath);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(EXPIRED);
    });
    desktop.close();
  });

  await test.step("Not me sends access_denied back to the app", async () => {
    const desktop = await desktopSignIn(BASE_URL);
    await page.goto(desktop.authorizePath);
    await page.getByRole("button", { name: "Not me, cancel" }).click();
    const callback = await desktop.callback;
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.has("code")).toBe(false);
    desktop.close();
  });
});

test("signed out, the confirmation page sends the person to sign in and back", async ({ page }) => {
  const desktop = await desktopSignIn(BASE_URL);
  await page.goto(desktop.authorizePath);
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fnative%2Fauthorize%3Frequest%3D/);
  desktop.close();
});

test("a request the app never made is refused", async ({ page }) => {
  await page.goto("/native/authorize?request=not-a-request");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(EXPIRED);
});

test("inside the desktop app, the provider buttons sign in through the system browser", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, {
      desktopCalls: calls,
      pheanDesktop: { version: "0.1.0", platform: "linux", signInWithBrowser: async (provider: string) => void calls.push(provider), openInBrowser: async () => {} },
    });
  });
  await page.goto("/sign-in");
  const github = page.getByRole("button", { name: "Continue with GitHub in your browser" });
  await expect(github).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google in your browser" })).toBeVisible();
  await github.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { desktopCalls: string[] }).desktopCalls)).toEqual(["github"]);
  await expect(page).toHaveURL(/\/sign-in/);
});
