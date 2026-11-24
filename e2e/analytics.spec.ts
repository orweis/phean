import { expect, test, type Page } from "@playwright/test";

import { BASE_URL, DEMO_SESSION } from "./support/env";
import { openTab } from "./support/navigation";

/** The GA test id the server is started with (playwright.config.ts); it loads only for a browser that sets the test cookie. */
const TEST_ID = "G-E2ETEST01";
const SLUG = "globex";

/** What gtag was asked to send, as plain arrays (dataLayer holds Arguments objects). */
function dataLayer(page: Page): Promise<unknown[][]> {
  return page.evaluate(() => ((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>)));
}

async function events(page: Page, name: string): Promise<Record<string, unknown>[]> {
  return (await dataLayer(page)).filter((entry) => entry[0] === "event" && entry[1] === name).map((entry) => entry[2] as Record<string, unknown>);
}

test.describe("without analytics", () => {
  test.use({ storageState: DEMO_SESSION });

  test("loads no Google script and asks nothing, on the site and in the app", async ({ page }) => {
    const google: string[] = [];
    page.on("request", (request) => {
      if (/google-analytics|googletagmanager/.test(request.url())) google.push(request.url());
    });
    for (const path of ["/", "/docs", `/w/${SLUG}`]) {
      await page.goto(path);
      await expect(page.locator("[data-consent-bar]")).toHaveCount(0);
      expect(await page.locator('script[src*="googletagmanager"]').count(), path).toBe(0);
      expect(await page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag), path).toBe("undefined");
    }
    expect(google).toEqual([]);
  });
});

test.describe("with analytics", () => {
  test.use({ storageState: DEMO_SESSION });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: "phean-analytics-test", value: "1", url: BASE_URL }]);
    // gtag.js itself never loads in tests; the page's own gtag stub records into dataLayer.
    await context.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  });

  test("asks first, then sends redacted page views and product events", async ({ page }) => {
    await page.goto(`/w/${SLUG}`);
    const bar = page.getByRole("region", { name: "Analytics" });
    await expect(bar).toBeVisible();
    expect(await page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe("undefined");

    await bar.getByRole("button", { name: "Accept" }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.locator(`script[src*="googletagmanager.com/gtag/js?id=${TEST_ID}"]`)).toHaveCount(1);

    await expect.poll(async () => (await events(page, "page_view")).length).toBeGreaterThan(0);
    const [view] = await events(page, "page_view");
    expect(view).toMatchObject({ page_path: "/w/[slug]", page_template: "/w/[slug]", page_title: "/w/[slug]", content_group: "app", surface: "app", signed_in: true });
    expect(String(view!.page_location)).toBe(`${BASE_URL}/w/[slug]`);

    await openTab(page, SLUG, "Decisions");
    await expect.poll(async () => (await events(page, "tab_open")).map((event) => event.tab)).toContain("decisions");
    await expect.poll(async () => (await events(page, "page_view")).map((event) => event.page_path)).toContain("/w/[slug]/decisions");

    // Nothing that names the workspace, its people or its work reaches gtag.
    const sent = JSON.stringify(await dataLayer(page));
    for (const secret of [SLUG, "Globex", "Dana", "demo@"]) expect(sent, secret).not.toContain(secret);
  });

  test("remembers a refusal and sends nothing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("region", { name: "Analytics" }).getByRole("button", { name: "Decline" }).click();
    await page.reload();
    await expect(page.locator("[data-consent-bar]")).toHaveCount(0);
    expect(await page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe("undefined");
    // The footer's "Analytics choice" asks again.
    await page.getByRole("button", { name: "Analytics choice" }).click();
    await expect(page.getByRole("region", { name: "Analytics" })).toBeVisible();
  });

  test("keeps the consent bar inside a phone's screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const box = await page.getByRole("region", { name: "Analytics" }).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    for (const name of ["Accept", "Decline"]) {
      const button = await page.getByRole("button", { name }).boundingBox();
      expect(button!.height, name).toBeGreaterThanOrEqual(32);
    }
  });
});
