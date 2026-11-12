import { expect, test } from "@playwright/test";

import { expectAccessible } from "./support/checks";

test("the landing page leads with the value, shows the product at work, and the way in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI agents do the tasks. You make the calls.");
  // The animated pictures of the product say what they show to a screen reader.
  await expect(page.getByRole("figure").filter({ hasText: /copywriter agent asks which subject line goes out/i })).toBeAttached();
  await expect(page.getByRole("list", { name: "Waiting on you" }).getByRole("listitem")).toHaveCount(4);

  // Use cases are tabs: arrow keys move between them and show each team's sample morning.
  const tabs = page.getByRole("tablist", { name: "Who runs a fleet of agents" });
  await tabs.getByRole("tab", { name: "Marketing teams" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Software factories" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Coding agents in parallel");
  await expect(page.getByRole("list", { name: "A sample morning for software factories" })).toContainText("cursor or offset pagination");
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "Founders & chiefs of staff" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab", { name: "Personal assistants" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("list", { name: "A sample morning for personal assistants" })).toContainText("aisle seat");

  // The name, explained, and drawn: agents roll the boulder up the hill and stop for the person's call.
  const name = page.getByRole("region", { name: "Why Phean? Because the work is Sisyphean." });
  await expect(name).toContainText("short for Sisyphean");
  await expect(name.getByRole("figure")).toContainText("three AI agents rolling a boulder up a hill");
  await expect(name.getByRole("heading", { level: 3 })).toHaveText(["Agents push", "You make the call", "The next one is waiting"]);

  // Personal assistants, named, with their requests on one page.
  const assistants = page.getByRole("region", { name: "Built for personal assistants." });
  await expect(assistants).toContainText("Grok, Dots, Instinct, Muse");
  await expect(assistants.getByRole("list", { name: "Your assistants are asking" }).getByRole("listitem").filter({ has: page.getByRole("list", { name: "Options" }) })).toHaveCount(3);

  // The real timetable, drawn from sample data.
  const line = page.getByRole("region", { name: "Every task on one line." });
  await expect(line.locator("li[data-task]")).not.toHaveCount(0);
  await expect(line.locator("[data-now]")).toContainText("Now");

  await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL("/sign-up");
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
});

test("the landing page's animations can be paused and played again", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Pause the animations" });
  const playing = () =>
    page.evaluate(() => [...document.querySelectorAll("[data-demo] *, [data-hill] *, [data-marquee]")].filter((element) => getComputedStyle(element).animationName !== "none" && getComputedStyle(element).animationPlayState === "running").length);
  expect(await playing()).toBeGreaterThan(0);
  await toggle.click();
  await expect(page.getByRole("button", { name: "Play the animations" })).toHaveAttribute("aria-pressed", "true");
  expect(await playing()).toBe(0);
  await page.getByRole("button", { name: "Play the animations" }).click();
  expect(await playing()).toBeGreaterThan(0);
});

test("the landing page keeps still for people who ask for less motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const animated = await page.evaluate(() =>
    [...document.querySelectorAll("[data-demo] *, [data-hill] *, [data-marquee], [data-rise], [data-drift]")].filter((element) => getComputedStyle(element).animationName !== "none").length,
  );
  expect(animated).toBe(0);
  await context.close();
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


  // Each agent has its own page under Agents, from connecting it to hearing back.
  await page.goto("/docs/agents");
  await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
  await page.getByRole("table").getByRole("link", { name: "Grok" }).click();
  await expect(page).toHaveURL("/docs/grok");
  for (const section of ["Connect in the Grok app", "Teach it Phean", "Sync up", "Hear back"]) await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();

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
  // Let the hand-off land before leaving, or it interrupts the next navigation.
  await page.waitForURL(/^https:\/\/github\.com\//);

  await page.goto("/sign-in?error=access_denied");
  await expect(page.getByRole("alert").filter({ hasText: "cancelled" })).toHaveText("Sign-in was cancelled at the provider. Try again, or use your email.");
});
