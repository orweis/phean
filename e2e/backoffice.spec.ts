import { expect, test } from "@playwright/test";

import { card } from "./support/locators";
import { ADMIN_SESSION, DEMO_SESSION } from "./support/env";

test.describe("as a customer", () => {
  test.use({ storageState: DEMO_SESSION });

  test("the backoffice is a 404, and so is its export", async ({ page }) => {
    for (const path of ["/admin", "/admin/workspaces", "/admin/workspaces/globex", "/admin/audit"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    expect((await page.request.get("/admin/workspaces/export")).status()).toBe(404);
    // Nor does the workspaces page point there.
    await page.goto("/workspaces");
    await expect(page.getByRole("link", { name: "Backoffice" })).toHaveCount(0);
  });
});

test("signed out, the backoffice asks for a sign-in first", async ({ page }) => {
  await page.goto("/admin/workspaces");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%2Fworkspaces/);
});

test.describe("as a platform admin", () => {
  test.use({ storageState: ADMIN_SESSION });

  test("reads the overview, finds a workspace, and shows its content with a reason", async ({ page }) => {
    await page.goto("/workspaces");
    await page.getByRole("link", { name: "Backoffice" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Backoffice" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("no two-factor");
    // Each trend says every week's figure in a table.
    await expect(page.getByRole("table", { name: "New signups, per week, oldest first" })).toBeAttached();

    await page.getByRole("navigation", { name: "Backoffice" }).getByRole("link", { name: "Workspaces" }).click();
    await page.getByRole("searchbox", { name: "Search workspaces" }).fill("park");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=park/);
    const table = page.getByRole("region", { name: "Workspaces" });
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table.getByText("Webhooks failing")).toBeVisible();

    // The export carries the same filter.
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await (await download).path();
    const { readFile } = await import("node:fs/promises");
    const csv = await readFile(file, "utf8");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
    expect(csv).toContain("Park Legal");

    // The workspace itself waits for a reason, like its content.
    await page.goto("/w/park-legal");
    await expect(page).toHaveURL(/\/admin\/workspaces\/park-legal#content$/);
    await expect(page.getByRole("heading", { level: 1, name: "Park Legal" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open read-only" })).toHaveCount(0);
    const content = card(page, "Content");
    await expect(content.getByText(/Sample work/)).toHaveCount(0);
    await content.getByLabel("Why do you need to see it?").fill("Checking the failing webhook for ticket 812");
    await content.getByRole("button", { name: "Show content" }).click();
    await expect(content.getByRole("heading", { name: "Recent tasks" })).toBeVisible();
    await expect(content.getByText(/Sample work/).first()).toBeVisible();

    // Within the grant, the workspace opens read-only.
    await page.getByRole("link", { name: "Open read-only" }).click();
    await expect(page).toHaveURL("/w/park-legal");
    await expect(page.getByText("You are viewing this workspace as a platform admin")).toBeVisible();
    // Another workspace still asks for its own reason.
    await page.goto("/w/kato-studio");
    await expect(page).toHaveURL(/\/admin\/workspaces\/kato-studio#content$/);

    await page.getByRole("navigation", { name: "Backoffice" }).getByRole("link", { name: "Audit" }).click();
    const log = page.getByRole("region", { name: "Audit log" });
    // The reason is on the grant, and on the visit it opened.
    await expect(log.getByText("“Checking the failing webhook for ticket 812”")).toHaveCount(2);
    await expect(log.getByText("Exported workspaces").first()).toBeVisible();
    await expect(log.getByText("Opened the workspace").first()).toBeVisible();
  });
});
