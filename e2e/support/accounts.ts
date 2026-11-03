import { expect, type Page } from "@playwright/test";

import { slugify } from "../../src/lib/domain";

export interface Person {
  name: string;
  email: string;
  password: string;
}

/** A suffix unique to one test run, so specs running in parallel (and retries) never collide. */
export function runId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Someone who does not have an account yet. */
export function newPerson(name: string): Person {
  return { name, email: `${slugify(name)}-${runId()}@example.com`, password: "correct-horse-battery" };
}

/**
 * Signs a new person up and leaves them on their workspaces page. Better Auth allows three
 * sign-ups per 10 seconds from one client, and the specs run in parallel, so a spec signs up at
 * most one person; a second person can be the seeded demo account.
 */
export async function signUp(page: Page, person: Person): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(person.name);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(person.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/workspaces");
}

/** Creates a workspace from the workspaces page, keeping the URL the form suggests for its name. */
export async function createWorkspace(page: Page, name: string): Promise<{ slug: string }> {
  const slug = slugify(name);
  await page.getByLabel("Workspace name").fill(name);
  await expect(page.getByLabel("URL")).toHaveValue(slug);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(`/w/${slug}`);
  return { slug };
}

/** A fresh owner with a new workspace, for specs that write and so cannot share the seeded demo data. */
export async function newWorkspace(page: Page, name: string): Promise<{ slug: string; name: string; owner: Person }> {
  const owner = newPerson("Pat Person");
  await signUp(page, owner);
  const workspace = `${name} ${runId()}`;
  return { ...(await createWorkspace(page, workspace)), name: workspace, owner };
}
