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
  // Click until the tab takes it: a click that lands before the page hydrates does nothing.
  await expect(async () => {
    await tabs.getByRole("tab", { name: "Marketing teams" }).click();
    await expect(tabs.getByRole("tab", { name: "Marketing teams" })).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass();
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

test("the landing page's illustrations load at their size, with words for the ones that carry meaning", async ({ page }) => {
  await page.goto("/");
  // The hero shows one hill, the appearance's: the light one here, and the dark one is never fetched.
  const hero = page.locator('img[data-art="hero-light"]').first();
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute("alt", /boulder up a long violet hill/);
  await expect(page.locator('main img[data-art="hero-dark"]')).toBeHidden();
  for (const id of ["capture", "assistants", "decisions", "memory", "hearback"]) {
    const art = page.locator(`img[data-art="${id}"]`);
    await art.scrollIntoViewIfNeeded();
    await expect(art).toHaveAttribute("alt", /\w{4,}/);
    await expect(art).toHaveAttribute("width", /\d+/);
    await expect(art).toHaveAttribute("height", /\d+/);
    await expect.poll(() => art.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
  // The closing band's hills are decoration behind the words.
  await expect(page.locator('img[data-art="cta-band"]')).toHaveAttribute("alt", "");
  // Shared links show the social card.
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/marketing\/og-card-1200x630\.jpg$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
});

test("the landing page names the agents it works with, each with its mark and its docs page", async ({ page }) => {
  await page.goto("/");
  const strip = page.getByRole("region", { name: "Made for the agents you already run" });
  await expect(strip.getByRole("list", { name: "Coding agents" }).getByRole("link")).toHaveText(["Claude Code", "Cursor", "VS Code"]);
  const assistants = strip.getByRole("list", { name: "Assistants" }).getByRole("link");
  await expect(assistants).toHaveText(["Claude", "ChatGPT", "Grok", "Dots", "Muse", "Instinct"]);
  // Vendors' marks where an official or openly licensed one exists; a monogram chip otherwise.
  await expect(strip.locator("svg[data-mark]")).toHaveCount(8);
  await expect(strip.locator("[data-monogram]")).toHaveCount(1);
  await expect(strip.getByRole("link", { name: "Grok" }).locator("svg[data-mark=grok]")).toHaveCount(1);
  await expect(strip.getByRole("link", { name: "Muse" }).locator("svg[data-mark=muse]")).toHaveCount(1);
  await expect(strip.getByRole("link", { name: "Dots" }).locator("svg[data-mark=dots]")).toHaveCount(1);
  await expect(strip.getByRole("link", { name: "Cursor" })).toHaveAttribute("href", "/docs/cursor");
  await strip.getByRole("link", { name: "Grok" }).click();
  await expect(page).toHaveURL("/docs/grok");
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

test("the landing page shows agents handing a task between them, and tells it in words", async ({ page }) => {
  await page.goto("/#handoffs");
  const section = page.getByRole("region", { name: "Agents pass the work along. You see the whole picture." });
  const steps = section.getByRole("list", { name: "The handoff, step by step" }).getByRole("listitem");
  await expect(steps).toHaveCount(6);
  await expect(steps.getByRole("heading", { level: 3 })).toHaveText([
    "You ask Grok Bot",
    "Grok Bot drafts and hands off",
    "Claude's routine picks it up",
    "Claude researches and adds",
    "Claude hands it back",
    "Grok Bot sends it and finishes",
  ]);
  await expect(steps.nth(4)).toContainText("Handed back to Grok Bot: added 3 points");
  await expect(steps.nth(1)).toContainText("Handing off to Claude");

  // The picture plays while it is on screen, moving from beat to beat, and its own Pause holds it.
  const stage = section.locator("[data-handoff]");
  await stage.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const beat = () => stage.evaluate((element) => Number(getComputedStyle(element).getPropertyValue("--beat")));
  await expect.poll(beat, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  // Each app comes to the front as its part plays: the chat first, then Phean, then Claude's session.
  await expect(stage).toHaveAttribute("data-front", "phean", { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-front", "claude", { timeout: 10_000 });
  await section.getByRole("button", { name: "Pause the handoff" }).click();
  await expect(section.getByRole("button", { name: "Play the handoff" })).toHaveAttribute("aria-pressed", "true");
  const held = await beat();
  await page.waitForTimeout(2500);
  expect(await beat()).toBe(held);
  await section.getByRole("button", { name: "Play the handoff" }).click();
  await expect.poll(beat, { timeout: 5000 }).not.toBe(held);
});

test("on a phone the handoff's apps are windows on a small desktop, about one screen tall", async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await phone.newPage();
  await page.goto("/#handoffs");
  const stage = page.locator("[data-handoff]");
  await stage.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const desk = stage.locator("[data-desk]");
  const { width, height } = (await desk.boundingBox())!;
  expect(height).toBeGreaterThanOrEqual(540);
  expect(height).toBeLessThanOrEqual(640);
  // The windows overlap, cascaded, and each stays inside the desk (where it sits when open, not as it opens).
  const boxes = await desk.locator("[data-window]").evaluateAll((windows) =>
    windows.map((window) => {
      const element = window as HTMLElement;
      return { left: element.offsetLeft, top: element.offsetTop, right: element.offsetLeft + element.offsetWidth, bottom: element.offsetTop + element.offsetHeight };
    }),
  );
  expect(boxes).toHaveLength(3);
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width + 1);
    expect(box.bottom).toBeLessThanOrEqual(height + 1);
  }
  expect(boxes[1]!.top).toBeGreaterThan(boxes[0]!.top);
  expect(boxes[2]!.top).toBeGreaterThan(boxes[1]!.top);
  // Everything on it reads at 12px or more.
  const small = await desk.evaluate((element) =>
    [...element.querySelectorAll("*")]
      .filter((node) => [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent!.trim()))
      .filter((node) => parseFloat(getComputedStyle(node).fontSize) < 12)
      .map((node) => node.textContent!.trim().slice(0, 30)),
  );
  expect(small).toEqual([]);
  // The chat opens first, and the others open over it as the story reaches them.
  await expect(stage).toHaveAttribute("data-open", "grok");
  await expect(stage).toHaveAttribute("data-open", /phean/, { timeout: 10_000 });
  await expect(stage).toHaveAttribute("data-open", /claude/, { timeout: 10_000 });
  await phone.close();
});

test("the handoff story is a still storyboard for people who ask for less motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/#handoffs");
  const section = page.getByRole("region", { name: "Agents pass the work along. You see the whole picture." });
  // Every step shows, numbered, with its state; the moving picture and its Pause are gone.
  const steps = section.getByRole("list", { name: "The handoff, step by step" }).getByRole("listitem");
  await expect(steps).toHaveCount(6);
  for (const step of await steps.all()) await expect(step).toBeVisible();
  await expect(steps.first()).toContainText("1");
  await expect(section.getByRole("button", { name: /the handoff$/ })).toBeHidden();
  await expect(section.locator("[data-handoff] > [aria-hidden]")).toBeHidden();
  const moving = await section.evaluate((element) => [...element.querySelectorAll("*")].filter((node) => getComputedStyle(node).animationName !== "none").length);
  expect(moving).toBe(0);
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
  // Each agent in the table carries its mark beside its name.
  await expect(page.getByRole("table").getByRole("link", { name: "Cursor" }).locator("svg[data-mark]")).toHaveCount(1);
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

test("the site's menus reach every section, on a desktop and on a phone", async ({ browser, page }) => {
  await page.goto("/blog");
  const site = page.getByRole("navigation", { name: "Site" });
  await expect(site.getByRole("link", { name: "Blog" })).toHaveAttribute("aria-current", "page");

  await site.getByRole("button", { name: "Product" }).click();
  await expect(site.getByRole("button", { name: "Product" })).toHaveAttribute("aria-expanded", "true");
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(site.getByRole("button", { name: "Product" })).toHaveAttribute("aria-expanded", "false");
  await expect(site.getByRole("button", { name: "Product" })).toBeFocused();

  await site.getByRole("button", { name: "Use cases" }).click();
  await site.getByRole("link", { name: /^Software factories/ }).click();
  await expect(page).toHaveURL("/#use-case-software");
  await expect(page.getByRole("tab", { name: "Software factories" })).toHaveAttribute("aria-selected", "true");

  await site.getByRole("button", { name: "Agents" }).click();
  await site.getByRole("link", { name: /^Cursor/ }).click();
  await expect(page).toHaveURL("/docs/cursor");

  // The footer holds the whole map on every page.
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("navigation", { name: "Developers" }).getByRole("link", { name: "MCP reference" })).toHaveAttribute("href", "/docs/mcp-reference");

  const phone = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const mobile = await phone.newPage();
  await mobile.goto("/");
  await expect(mobile.getByRole("navigation", { name: "Site" })).toBeHidden();
  await mobile.getByRole("button", { name: "Menu" }).click();
  const sheet = mobile.getByRole("navigation", { name: "Menu" });
  await expect(sheet).toBeVisible();
  await expectAccessible(mobile);
  await sheet.getByRole("link", { name: "Blog", exact: true }).first().click();
  await expect(mobile).toHaveURL("/blog");
  await expect(sheet).toBeHidden();
  await phone.close();
});
