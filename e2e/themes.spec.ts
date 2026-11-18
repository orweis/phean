import { expect, test, type Locator, type Page } from "@playwright/test";

import { DEFAULT_THEME, THEME_COOKIE, THEME_PAPER } from "../src/lib/themes";
import { expectAccessible, expectNothingCutOff } from "./support/checks";
import { BASE_URL, DEMO_SESSION } from "./support/env";
import { appearanceOption, card, popover, themeOption } from "./support/locators";

/** The ground's colour as the browser paints it, in sRGB through a canvas, and whether it is dark. */
function ground(page: Page) {
  return page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return { rgb: `${r},${g},${b}`, dark: (r + g + b) / 3 < 128 };
  });
}

const themeColors = (page: Page) => page.locator('meta[name="theme-color"]').evaluateAll((metas) => metas.map((meta) => (meta as HTMLMetaElement).content));

/** The radio inside a theme option, which carries its checked state for assistive tech. */
const radio = (scope: Locator, option: string) => scope.getByRole("group", { name: "Theme" }).getByRole("radio", { name: option });

test.describe("signed in", () => {
  test.use({ storageState: DEMO_SESSION, colorScheme: "light" });

  test("the account menu switches the theme at once, and the choice sticks and combines with Dark", async ({ page }) => {
    await page.goto("/w/globex");
    const html = page.locator("html");
    const account = popover(page, "Dana Demo");

    await test.step(`with no choice made, the app is in ${DEFAULT_THEME}`, async () => {
      await expect(html).toHaveAttribute("data-theme", DEFAULT_THEME);
      await account.locator("summary").click();
      await expect(radio(account, "Dusk")).toBeChecked();
      await expect(themeOption(account, "Dusk")).toHaveAttribute("data-selected", "");
    });

    const before = await ground(page);
    await test.step("picking Ink repaints the page without a reload, browser chrome included", async () => {
      await themeOption(account, "Ink").click();
      await expect(html).toHaveAttribute("data-theme", "ink");
      await expect(radio(account, "Ink")).toBeChecked();
      await expect(themeOption(account, "Ink")).toHaveAttribute("data-selected", "");
      await expect(themeOption(account, "Dusk")).not.toHaveAttribute("data-selected");
      await expect.poll(async () => (await ground(page)).rgb).not.toBe(before.rgb);
      expect((await ground(page)).dark).toBe(false);
      expect(await themeColors(page)).toEqual([THEME_PAPER.ink.light, THEME_PAPER.ink.dark]);
    });

    await test.step("the server renders the theme on the next page load", async () => {
      await page.goto("/w/globex/board");
      await expect(html).toHaveAttribute("data-theme", "ink");
      const cookies = await page.context().cookies(BASE_URL);
      expect(cookies.find((cookie) => cookie.name === THEME_COOKIE)?.value).toBe("ink");
    });

    await test.step("Dark combines with the theme, and the chrome takes its dark paper", async () => {
      await account.locator("summary").click();
      await appearanceOption(account, "Dark").click();
      await expect(html).toHaveAttribute("data-appearance", "dark");
      await expect.poll(async () => (await ground(page)).dark).toBe(true);
      expect(await themeColors(page)).toEqual([THEME_PAPER.ink.dark, THEME_PAPER.ink.dark]);
      await page.reload();
      await expect(html).toHaveAttribute("data-theme", "ink");
      await expect(html).toHaveAttribute("data-appearance", "dark");
      expect((await ground(page)).dark).toBe(true);
    });

    await test.step("arrow keys move between themes, each applying as it is reached", async () => {
      await account.locator("summary").click();
      await radio(account, "Ink").focus();
      await page.keyboard.press("ArrowRight");
      await expect(html).toHaveAttribute("data-theme", "console");
      await expect(radio(account, "Console")).toBeChecked();
      await expect(radio(account, "Console")).toBeFocused();
    });

    await test.step("the menu has no detectable accessibility violations", async () => {
      await expectAccessible(page);
    });
  });

  test("the account page's Appearance card holds both pickers, and the account menu follows it", async ({ page }) => {
    await page.goto("/account");
    const appearance = card(page, "Appearance");
    await expect(appearance.getByRole("group", { name: "Theme" })).toBeVisible();
    await expect(appearance.getByRole("group", { name: "Appearance" })).toBeVisible();
    await themeOption(appearance, "Ledger").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ledger");
    const account = popover(page, "Dana Demo");
    await account.locator("summary").click();
    await expect(radio(account, "Ledger")).toBeChecked();
    await expect(themeOption(account, "Ledger")).toHaveAttribute("data-selected", "");
  });

  test.describe("on a 375px phone", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("the theme picker fits the account sheet and the account page", async ({ page }) => {
      await page.goto("/account");
      await expect(card(page, "Appearance").getByRole("group", { name: "Theme" })).toBeVisible();
      await expectNothingCutOff(page);
      const account = popover(page, "Dana Demo");
      await account.locator("summary").click();
      await expect(account.getByRole("group", { name: "Theme" })).toBeInViewport();
      await expectNothingCutOff(page);
    });
  });
});

test("a visitor picks a theme in the landing page's footer, and the sign-in page opens in it", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(radio(footer, "Dusk")).toBeChecked();
  await themeOption(footer, "Console").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "console");
  await appearanceOption(footer, "Dark").click();
  await expect.poll(async () => (await ground(page)).dark).toBe(true);
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "console");
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
});
