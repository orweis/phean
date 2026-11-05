import type { Locator, Page } from "@playwright/test";

/** A card (or any section) found by its heading text. */
export const card = (page: Page, title: string | RegExp) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: typeof title === "string" }) });

/** A popover (a `<details>` panel) found by the text of its trigger, on the page or within one part of it. */
export const popover = (scope: Page | Locator, trigger: string) => {
  // A `has` locator matches inside each candidate, so it must start from the page, not the scope.
  const page = "page" in scope ? scope.page() : scope;
  return scope.locator("details").filter({ has: page.locator("summary", { hasText: trigger }) });
};

/** An option of the Task/Goal switch in the Add manually panel. Its radios are visually hidden, so this is the label a person clicks. */
export const entryKind = (entry: Locator, kind: "Task" | "Goal") => entry.getByRole("group", { name: "What to add" }).getByText(kind, { exact: true });

/** An option of an appearance picker, the label a person clicks. */
export const appearanceOption = (scope: Locator, option: "Light" | "Dark" | "System") =>
  scope.getByRole("group", { name: "Appearance" }).getByText(option, { exact: true });

/** A board lane by task status. */
export const lane = (page: Page, stage: "inbox" | "backlog" | "todo" | "in_progress" | "done" | (string & {})) => page.locator(`section[aria-labelledby="lane-${stage}"]`);
