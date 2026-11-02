import { expect, test as setup } from "@playwright/test";

import { DEMO_USER } from "../scripts/demo-account";
import { DEMO_SESSION } from "./support/env";

/** Signs in once as the seeded demo account; sign-in is rate limited, so specs reuse this session. */
setup("sign in as the demo account", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEMO_USER.email);
  await page.getByLabel("Password").fill(DEMO_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/workspaces");
  await page.context().storageState({ path: DEMO_SESSION });
});
