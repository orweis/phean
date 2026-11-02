import type { Page } from "@playwright/test";

/** A card (or any section) found by its heading text. */
export const card = (page: Page, title: string | RegExp) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: typeof title === "string" }) });

/** A board lane by task status. */
export const lane = (page: Page, status: "inbox" | "todo" | "in_progress" | "done") => page.locator(`section[aria-labelledby="lane-${status}"]`);

/** A UTC calendar day relative to today, as the YYYY-MM-DD agents send. */
export const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
