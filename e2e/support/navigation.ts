import { expect, type Page } from "@playwright/test";

import { routes } from "../../src/lib/routes";

const TABS = {
  Overview: routes.workspace,
  Decisions: routes.decisions,
  Tasks: routes.board,
  Goals: routes.goals,
  Timeline: routes.timeline,
  Memory: routes.memory,
  Documents: routes.documents,
  Search: routes.search,
  Agents: routes.agents,
  Members: routes.members,
} satisfies Record<string, (slug: string) => string>;

/**
 * Opens a workspace tab and waits for it to load. Pages share controls (memory and search both
 * have a search box), so acting before the URL changes can land on the page being left.
 */
export async function openTab(page: Page, slug: string, tab: keyof typeof TABS): Promise<void> {
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: new RegExp(`^${tab}`) }).click();
  await expect(page).toHaveURL(TABS[tab](slug));
}
