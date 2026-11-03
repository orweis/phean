import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Nothing reaches past either edge of the viewport. The root clips horizontal overflow, so a
 * page can look fine while content is cut off: this looks for the content itself, outside any
 * scrolling or clipping ancestor, and for anything that still widens the document, such as an
 * absolutely positioned element escaping a scroller that is not its containing block.
 */
export async function expectNothingCutOff(page: Page) {
  const report = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const contained = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowX !== "visible") return true;
      }
      return false;
    };
    const offenders = [...document.body.querySelectorAll("*")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.right > width + 1 || box.left < -1) && !contained(element);
      })
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 4).join(".")}: ${element.textContent?.trim().slice(0, 40)}`);
    return { offenders, documentWidth: document.documentElement.scrollWidth, width };
  });
  expect(report.offenders, "elements past the edge of the viewport").toEqual([]);
  expect(report.documentWidth, "document width").toBeLessThanOrEqual(report.width);
}

/** On every timetable, the Now chip sits clear of each visible date label on the axis. */
export async function expectNowClearOfDates(page: Page) {
  const clashes = await page.evaluate(() =>
    [...document.querySelectorAll("[data-now] > span")].flatMap((chip) => {
      const now = chip.getBoundingClientRect();
      const timetable = chip.closest(".group\\/tt");
      return [...(timetable?.querySelectorAll("[data-tick]") ?? [])]
        .map((tick) => ({ text: tick.textContent, box: tick.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.left < now.right && box.right > now.left && box.top < now.bottom && box.bottom > now.top)
        .map(({ text }) => text);
    }),
  );
  expect(clashes, "date labels under the Now chip").toEqual([]);
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
