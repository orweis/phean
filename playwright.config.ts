import { defineConfig, devices } from "@playwright/test";

import { BASE_URL, PORT } from "./e2e/support/env";

/**
 * UI tests run against a production build (`next start`) on a fresh on-disk PGlite database,
 * seeded with the demo account. `pnpm test:e2e` builds first.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: ".data/e2e-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: ".data/e2e-report" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: {
    command: "pnpm e2e:serve",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: "pglite:./.data/e2e",
      BETTER_AUTH_URL: BASE_URL,
      // Test-only: signs sessions on a throwaway local database.
      BETTER_AUTH_SECRET: "phean-e2e-only-secret-not-for-real-deployments",
      PORT: String(PORT),
      // The webhooks spec delivers to a receiver on 127.0.0.1; production never allows this.
      PHEAN_WEBHOOK_ALLOW_PRIVATE: "1",
    },
  },
});
