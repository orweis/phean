import { expect, test } from "@playwright/test";

import { expectAccessible } from "./support/checks";

test("the landing page shows a sample timetable and the way in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const sample = page.getByRole("region", { name: "The timetable" });
  await expect(sample.getByRole("region", { name: "Close the quarter" })).toBeVisible();
  await expect(sample.locator("li[data-task]")).not.toHaveCount(0);
  await expect(sample.locator("[data-segment=in_progress]").first()).toBeVisible();
  await expect(sample.locator("[data-now]")).toContainText("Now");

  await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL("/sign-up");
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
});

test("the docs are one click from the landing page, and walk page to page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Docs" }).click();
  await expect(page).toHaveURL("/docs");
  await expect(page.getByRole("heading", { level: 1, name: "Phean docs" })).toBeVisible();

  await page.getByRole("link", { name: /^Next/ }).click();
  await expect(page).toHaveURL("/docs/getting-started");
  await expect(page.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();
  // The sidebar marks the page you are on (on a phone it sits in the collapsed "All docs pages").
  await expect(page.locator('nav[aria-label="Docs"] [aria-current="page"]').first()).toHaveText("Getting started");


  // Agents read the same docs as Markdown.
  const llms = await (await page.request.get("/llms.txt")).text();
  expect(llms).toMatch(/^# Phean/);
  expect(llms).toContain("/docs/webhooks");
});

test("a workspace page sends a signed-out visitor to sign in and back", async ({ page }) => {
  await page.goto("/w/acme/timeline");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fw%2Facme%2Ftimeline/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("a wrong password is refused with a message", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("demo@phean.dev");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /invalid email or password/i })).toBeVisible();
  await expect(page).toHaveURL("/sign-in");
});

for (const path of ["/", "/sign-in", "/sign-up", "/docs", "/docs/webhooks"]) {
  test(`${path} has no detectable accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expectAccessible(page);
  });
}

test("social sign-in hands off to the provider with Phean's callback, and says why when it comes back without a session", async ({ page }) => {
  // Stop at the provider: the spec checks the hand-off, not GitHub itself.
  let authorize: URL | null = null;
  await page.route("https://github.com/**", async (route) => {
    authorize = new URL(route.request().url());
    await route.fulfill({ status: 200, body: "GitHub" });
  });
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect.poll(() => authorize?.pathname).toBe("/login/oauth/authorize");
  expect(authorize!.searchParams.get("client_id")).toBe("phean-e2e-github");
  expect(authorize!.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/github$/);

  await page.goto("/sign-in?error=access_denied");
  await expect(page.getByRole("alert").filter({ hasText: "cancelled" })).toHaveText("Sign-in was cancelled at the provider. Try again, or use your email.");
});
