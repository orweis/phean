import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Elements that reach past the right edge of the viewport without a scrolling or clipping
 * ancestor to hold them. The root clips horizontal overflow, so a page can look fine to
 * `scrollWidth` while content is cut off; this finds the content itself.
 */
export async function expectNothingCutOff(page: Page) {
  const offenders = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    const contained = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowX !== "visible") return true;
      }
      return false;
    };
    return [...document.body.querySelectorAll("*")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.right > limit && !contained(element);
      })
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 4).join(".")}: ${element.textContent?.trim().slice(0, 40)}`);
  });
  expect(offenders, "elements past the right edge of the viewport").toEqual([]);
}

/** WCAG 2.1 A and AA violations axe can detect, reduced to what a failure message needs. */
export async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = violations.map(({ id, help, nodes }) => ({
    rule: id,
    help,
    targets: nodes.slice(0, 3).map((node) => node.target.join(" ")),
  }));
  expect(summary, "axe violations").toEqual([]);
}
