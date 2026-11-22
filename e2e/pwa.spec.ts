import { expect, test } from "@playwright/test";

import { routes } from "../src/lib/routes";
import { newWorkspace } from "./support/accounts";
import { BASE_URL } from "./support/env";
import { OAUTH_CLIENT_STATE, oauthClient } from "./support/oauth-client";

const BASELINE = ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "worker-src 'self'"];

/** The baseline policy of PLAN.md §4: its four directives, and never `form-action`. */
function expectBaseline(policy: string | undefined, objectSrc = "object-src 'none'") {
  for (const directive of BASELINE) expect(policy).toContain(directive.startsWith("object-src") ? objectSrc : directive);
  expect(policy).not.toContain("form-action");
}

test("the app is installable: a manifest with its icons, linked from every page", async ({ page, request }) => {
  await page.goto(routes.signIn());
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ name: "Phean", start_url: routes.workspaces(), scope: "/", display: "standalone" });
  for (const icon of manifest.icons as { src: string }[]) {
    const response = await request.get(icon.src);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
  expect(manifest.icons).toContainEqual(expect.objectContaining({ purpose: "maskable" }));
});

test("the service worker controls the origin, and a page load that cannot reach Phean shows the offline page", async ({ page, context, request }) => {
  const worker = await request.get(routes.serviceWorker());
  expect(worker.headers()["cache-control"]).toBe("no-cache");
  expect(worker.headers()["service-worker-allowed"]).toBe("/");

  await page.goto(routes.signIn());
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toBe(`${BASE_URL}/`);
  // A page loaded before the worker took over is not controlled; the next one is.
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // Signed out, a workspace page redirects to sign-in through the worker, as without it.
  await page.goto("/w/globex");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fw%2Fglobex$/);

  await context.setOffline(true);
  await page.goto("/w/globex/decisions").catch(() => {});
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Phean");
  await expect(page.getByText("You are offline")).toBeVisible();
  await expect(page).toHaveURL(/\/w\/globex\/decisions$/);

  await context.setOffline(false);
  await page.getByRole("link", { name: "Retry" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fw%2Fglobex%2Fdecisions$/);
});

test("the offline page stands alone, signed out", async ({ page }) => {
  const response = await page.goto(routes.offline());
  expect(response!.status()).toBe(200);
  expectBaseline(response!.headers()["content-security-policy"]);
  await expect(page.getByText("You are offline")).toBeVisible();
  await expect(page.getByRole("link", { name: "Retry" })).toBeVisible();
});

test("Android's asset links are JSON, served without a redirect or a session", async ({ request }) => {
  const response = await request.get("/.well-known/assetlinks.json", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^application\/json/);
  expect(Array.isArray(await response.json())).toBe(true);
});

test("app pages carry the baseline policy; the marketing site and the docs do not", async ({ request }) => {
  expectBaseline((await request.get(routes.signIn())).headers()["content-security-policy"]);
  expectBaseline((await request.get("/w/globex", { maxRedirects: 0 })).headers()["content-security-policy"], "object-src 'self'");
  for (const path of [routes.home(), routes.docs(), routes.blog()]) {
    expect((await request.get(path)).headers()["content-security-policy"]).toBeUndefined();
  }
});

test("under the policy, Allow still sends the browser back to the client with a code", async ({ page }) => {
  const workspace = await newWorkspace(page, "Policy Co");
  const client = await oauthClient(BASE_URL);
  const dialog = await page.goto(client.authorizationUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect Scripted Client to Phean");
  expect(dialog!.headers()["x-frame-options"]).toBe("DENY");
  expectBaseline(dialog!.headers()["content-security-policy"]);
  await expect(page.getByRole("radio", { name: workspace.name })).toBeChecked();

  await page.getByLabel("Agent name").fill("Policy agent");
  await page.getByRole("button", { name: "Allow" }).click();
  const callback = await client.callback();
  expect(callback.searchParams.get("state")).toBe(OAUTH_CLIENT_STATE);
  expect(callback.searchParams.has("code")).toBe(true);
  await expect(page.getByText("Connected. You can close this window.")).toBeVisible();
  client.close();
});
