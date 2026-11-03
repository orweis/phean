import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, expectNothingCutOff } from "./support/checks";
import { DEMO_SESSION } from "./support/env";
import { appearanceOption, popover } from "./support/locators";

const DARK_PAPER = "#0e0d17";

/** Whether the ground is painted dark: the body's background, converted to sRGB through a canvas. */
function groundIsDark(page: Page) {
  return page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3 < 128;
  });
}

const themeColors = (page: Page) => page.locator('meta[name="theme-color"]').evaluateAll((metas) => metas.map((meta) => (meta as HTMLMetaElement).content));

test.describe("signed in", () => {
  test.use({ storageState: DEMO_SESSION, colorScheme: "light" });

  test("the account menu switches between Light, Dark and System, and the choice sticks", async ({ page }) => {
    await page.goto("/w/globex");
    const account = popover(page, "Dana Demo");

    await test.step("with no choice made, the app follows the device", async () => {
      await expect(page.locator("html")).toHaveAttribute("data-appearance", "system");
      expect(await groundIsDark(page)).toBe(false);
      await page.emulateMedia({ colorScheme: "dark" });
      await expect.poll(() => groundIsDark(page)).toBe(true);
      await page.emulateMedia({ colorScheme: "light" });
    });

    await test.step("Dark applies at once on a light device, browser chrome included", async () => {
      await account.locator("summary").click();
      await expect(account.getByRole("radio", { name: "System" })).toBeChecked();
      await appearanceOption(account, "Dark").click();
      await expect.poll(() => groundIsDark(page)).toBe(true);
      expect(await themeColors(page)).toEqual([DARK_PAPER, DARK_PAPER]);
    });

    await test.step("the server renders the choice on the next page load", async () => {
      await page.goto("/w/globex/board");
      await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
      expect(await groundIsDark(page)).toBe(true);
      await account.locator("summary").click();
      await expect(account.getByRole("radio", { name: "Dark" })).toBeChecked();
    });

    await test.step("Light holds on a dark device", async () => {
      await page.emulateMedia({ colorScheme: "dark" });
      await appearanceOption(account, "Light").click();
      await expect.poll(() => groundIsDark(page)).toBe(false);
    });

    await test.step("System hands the choice back to the device", async () => {
      await appearanceOption(account, "System").click();
      await expect.poll(() => groundIsDark(page)).toBe(true);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-appearance", "system");
      expect(await groundIsDark(page)).toBe(true);
    });
  });

  test("the account menu has no detectable accessibility violations in either appearance", async ({ page }) => {
    await page.goto("/w/globex");
    const account = popover(page, "Dana Demo");
    await account.locator("summary").click();
    await expect(account.getByText("demo@phean.dev")).toBeVisible();
    await expectAccessible(page);
    await appearanceOption(account, "Dark").click();
    await expect.poll(() => groundIsDark(page)).toBe(true);
    await expectAccessible(page);
  });

  test.describe("on a 375px phone", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("the account menu opens as a sheet inside the screen", async ({ page }) => {
      await page.goto("/w/globex");
      const account = popover(page, "Dana Demo");
      await account.locator("summary").click();
      await expect(account.getByRole("group", { name: "Appearance" })).toBeInViewport();
      await expect(account.getByRole("button", { name: "Sign out" })).toBeInViewport();
      await expectNothingCutOff(page);
      await account.getByRole("button", { name: "Close" }).click();
      await expect(account.getByRole("group", { name: "Appearance" })).toBeHidden();
    });
  });
});

test("a visitor picks Dark on the landing page and the sign-in page opens in it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("radio", { name: "System" })).toBeChecked();

  const light = await page.evaluate(async () => {
    const labels = [...document.querySelectorAll<HTMLLabelElement>("footer label")];
    const option = (text: string) => labels.find((label) => label.textContent?.trim() === text)!;
    const light = option("Light");
    option("Dark").click();
    const onSwitch = getComputedStyle(light).color;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { onSwitch, settled: getComputedStyle(light).color };
  });
  expect(light.onSwitch, "a segment with a colour transition repaints on the frame of the switch").toBe(light.settled);
  expect(await groundIsDark(page)).toBe(true);
  await expect(footer.getByRole("radio", { name: "Dark" })).toBeChecked();
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  expect(await groundIsDark(page)).toBe(true);
});
