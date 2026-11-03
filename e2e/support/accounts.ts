import { expect, type Page } from "@playwright/test";

/**
 * Signs up a fresh owner and creates a workspace, for specs that write and so cannot share the
 * seeded demo data. Sign-up is rate limited, so a spec should call this once.
 */
export async function newWorkspace(page: Page, name: string): Promise<{ slug: string }> {
  const run = Date.now().toString(36);
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${run}`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Pat Person");
  await page.getByLabel("Email").fill(`pat-${run}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/workspaces");
  await page.getByLabel("Workspace name").fill(`${name} ${run}`);
  await page.getByLabel("URL").fill(slug);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(`/w/${slug}`);
  return { slug };
}
