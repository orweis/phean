import type { Locator, Page } from "@playwright/test";

/** A card (or any section) found by its heading text. */
export const card = (page: Page, title: string | RegExp) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: typeof title === "string" }) });

/** A popover (a `<details>` panel) found by the text of its trigger. */
export const popover = (page: Page, trigger: string) => page.locator("details").filter({ has: page.locator("summary", { hasText: trigger }) });

/** An option of the Task/Goal switch in the Add manually panel. Its radios are visually hidden, so this is the label a person clicks. */
export const entryKind = (entry: Locator, kind: "Task" | "Goal") => entry.getByRole("group", { name: "What to add" }).getByText(kind, { exact: true });

/** A board lane by task status. */
export const lane = (page: Page, status: "inbox" | "todo" | "in_progress" | "done") => page.locator(`section[aria-labelledby="lane-${status}"]`);

/** A UTC calendar day relative to today, as the YYYY-MM-DD agents send. */
export const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
