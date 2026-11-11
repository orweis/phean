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
      // Every spec registers its OAuth clients from this one address.
      PHEAN_OAUTH_REGISTER_LIMIT: "1000",
      // And sends every dialog through authorize from it.
      PHEAN_OAUTH_AUTHORIZE_LIMIT: "1000",
      // Placeholder social sign-in apps, so the sign-in page shows its provider buttons; the spec stops at the provider.
      GITHUB_CLIENT_ID: "phean-e2e-github",
      GITHUB_CLIENT_SECRET: "phean-e2e-github-secret",
      GOOGLE_CLIENT_ID: "phean-e2e-google",
      GOOGLE_CLIENT_SECRET: "phean-e2e-google-secret",
      // Email is "set up" so the digest's form shows; the hourly send is never called in these tests.
      RESEND_API_KEY: "phean-e2e-resend-key",
      PHEAN_EMAIL_FROM: "Phean <digest@phean.test>",
    },
  },
});
