import { expect, test as setup } from "@playwright/test";

import { DEMO_ADMIN, DEMO_USER } from "../scripts/demo-account";
import { ADMIN_SESSION, DEMO_SESSION } from "./support/env";

/** Signs in once as the seeded demo account; sign-in is rate limited, so specs reuse this session. */
setup("sign in as the demo account", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEMO_USER.email);
  await page.getByLabel("Password").fill(DEMO_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/workspaces");
  await page.context().storageState({ path: DEMO_SESSION });
});

/** And once as the seeded platform admin (listed in PHEAN_PLATFORM_ADMINS by the test server), for the backoffice. */
setup("sign in as the platform admin", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEMO_ADMIN.email);
  await page.getByLabel("Password").fill(DEMO_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/workspaces");
  await page.context().storageState({ path: ADMIN_SESSION });
  // Better Auth allows three sign-ins per 10 seconds from one client. Let this one age out of the
  // window before the specs start, so the specs that sign people in keep the room they had.
  await page.waitForTimeout(10_500);
});
