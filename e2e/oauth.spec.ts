import { expect, test, type Page } from "@playwright/test";

import { DEMO_USER } from "../scripts/demo-account";
import { LIMITS } from "../src/lib/domain";
import { newPerson, newWorkspace, runId, signUp } from "./support/accounts";
import { BASE_URL, DEMO_SESSION } from "./support/env";
import { card, popover } from "./support/locators";
import { openTab } from "./support/navigation";
import { OAUTH_CLIENT_STATE, oauthClient, type OAuthTestClient } from "./support/oauth-client";

const REPLACES = "You already have an agent with this name. Allowing replaces its connection.";

const allow = (page: Page) => page.getByRole("button", { name: "Allow" });
const accessTo = (page: Page, workspace: string) => page.getByRole("group", { name: `Access to ${workspace}` });

/** Opens the dialog as the client would, and waits for it. */
async function openDialog(page: Page, client: OAuthTestClient, clientName = "Scripted Client") {
  await page.goto(client.authorizationUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Connect ${clientName} to Phean`);
}

test.describe("with the demo account", () => {
  test.use({ storageState: DEMO_SESSION });

  test("Cancel returns access_denied to the client", async ({ page }) => {
    const client = await oauthClient(BASE_URL);
    await openDialog(page, client);
    // Nothing is picked yet: cancelling needs no valid form.
    await page.getByRole("button", { name: "Cancel" }).click();
    const callback = await client.callback();
    expect(callback.searchParams.get("error")).toBe("access_denied");
    expect(callback.searchParams.get("state")).toBe(OAUTH_CLIENT_STATE);
    expect(callback.searchParams.get("iss")).toBe(`${BASE_URL}/api/auth`);
    expect(callback.searchParams.has("code")).toBe(false);
  });

  test("the dialog says where the connection goes, who names the client, and refuses frames", async ({ page }) => {
    const client = await oauthClient(BASE_URL);
    const response = await page.goto(client.authorizationUrl);
    expect(response!.headers()["x-frame-options"]).toBe("DENY");
    expect(response!.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
    await expect(page.getByText("127.0.0.1", { exact: true })).toBeVisible();
    await expect(page.getByText("is the name this client gave itself")).toBeVisible();
    await expect(page.getByText("A client's name proves nothing")).toBeVisible();
    await expect(page.getByText("Signed in as Dana Demo")).toBeVisible();
  });

  test("a web address does not get the warning for this computer", async ({ page }) => {
    const client = await oauthClient(BASE_URL, { redirectUri: "https://client.example/callback" });
    await openDialog(page, client);
    await expect(page.getByText("client.example", { exact: true })).toBeVisible();
    await expect(page.getByText("A client's name proves nothing")).toHaveCount(0);
  });

  test("only one workspace and level can be chosen, and choosing a level chooses its workspace", async ({ page }) => {
    const client = await oauthClient(BASE_URL);
    await openDialog(page, client);
    const acme = page.getByRole("radio", { name: "Acme Corp" });
    const globex = page.getByRole("radio", { name: "Globex" });
    await expect(acme).not.toBeChecked();
    await expect(globex).not.toBeChecked();

    await accessTo(page, "Globex").getByText("Read", { exact: true }).click();
    await expect(globex).toBeChecked();
    await expect(accessTo(page, "Globex").getByRole("radio", { name: "Read" })).toBeChecked();

    await acme.check();
    await expect(globex).not.toBeChecked();
    await expect(accessTo(page, "Acme Corp").getByRole("radio", { name: "Write" })).toBeChecked();
    await expect(accessTo(page, "Globex").getByRole("radio", { name: "Read" })).not.toBeChecked();

    await expect(page.getByRole("group", { name: "Access lasts" }).getByRole("radio", { name: "30 days" })).toBeChecked();
    await page.getByRole("group", { name: "Access lasts" }).getByText("1 year", { exact: true }).click();
    await expect(page.getByRole("group", { name: "Access lasts" }).getByRole("radio", { name: "1 year" })).toBeChecked();
    const end = new Date(Date.now() + 365 * 24 * 3600 * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    await expect(page.getByText(`Access ends on ${end}.`)).toBeVisible();
  });

  test("a tampered request shows an error and no form", async ({ page }) => {
    const client = await oauthClient(BASE_URL);
    await openDialog(page, client);
    const url = new URL(page.url());
    url.searchParams.set("redirect_uri", "https://evil.example/callback");
    await page.goto(url.toString());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This connection request is not valid");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(allow(page)).toHaveCount(0);
    await expect(page.getByText("evil.example")).toHaveCount(0);
  });

  test("a request past its ten minutes runs authorize again and shows a fresh dialog", async ({ page }) => {
    const client = await oauthClient(BASE_URL);
    await openDialog(page, client);
    const url = new URL(page.url());
    const issued = Number(url.searchParams.get("exp"));
    url.searchParams.set("exp", String(Math.floor(Date.now() / 1000) - 60));
    await page.goto(url.toString());
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect Scripted Client to Phean");
    const fresh = new URL(page.url());
    expect(fresh.pathname).toBe("/oauth/approve");
    expect(Number(fresh.searchParams.get("exp"))).toBeGreaterThanOrEqual(issued);
    expect(fresh.searchParams.get("client_id")).toBe(client.clientId);
  });

  test("a posted workspace the person is not in is refused", async ({ page }) => {
    const client = await oauthClient(BASE_URL);
    await openDialog(page, client);
    const name = `Forged ${runId()}`;
    await page.getByLabel("Agent name").fill(name);
    const acme = page.getByRole("radio", { name: "Acme Corp" });
    await acme.check();
    await acme.evaluate((radio: HTMLInputElement) => (radio.value = "someone-elses-workspace"));
    await allow(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose one of your workspaces." })).toBeVisible();
    await expect(page).toHaveURL(/\/oauth\/approve/);

    for (const slug of ["acme", "globex"]) {
      await page.goto(`/w/${slug}/agents`);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByText(name)).toHaveCount(0);
    }
  });

  test("signing out mid-dialog returns to the same dialog after sign-in", async ({ page, context }) => {
    const client = await oauthClient(BASE_URL);
    await openDialog(page, client);
    await page.getByRole("radio", { name: "Acme Corp" }).check();
    const dialog = page.url();
    // Only this browser forgets the session: the demo session itself stays valid for the other specs.
    await context.clearCookies();

    await test.step("loading the dialog signed out goes to sign-in and keeps the way back", async () => {
      const other = await context.newPage();
      await other.goto(dialog);
      await expect(other).toHaveURL(/\/sign-in\?next=%2Foauth%2Fapprove%3F/);
      await other.close();
    });

    await test.step("Allow with the session gone goes to sign-in, and from there to the dialog", async () => {
      await allow(page).click();
      await expect(page).toHaveURL(/\/sign-in\?/);
      await page.getByLabel("Email").fill(DEMO_USER.email);
      await page.getByLabel("Password").fill(DEMO_USER.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/oauth\/approve\?/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect Scripted Client to Phean");
      expect(new URL(page.url()).searchParams.get("client_id")).toBe(client.clientId);
    });
  });

  test("a hostile client name renders as text and the prefill is cut to the limit", async ({ page }) => {
    const hostile = `<img src=x onerror="window.pwned=1">${"A".repeat(LIMITS.name * 2)}`;
    const client = await oauthClient(BASE_URL, {
      clientName: hostile,
      metadata: {
        client_uri: "https://evil.example/home",
        logo_uri: "https://evil.example/logo.png",
        tos_uri: "https://evil.example/tos",
        policy_uri: "https://evil.example/policy",
      },
    });
    const shown = hostile.slice(0, LIMITS.name);
    await page.goto(client.authorizationUrl);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Connect ${shown} to Phean`);
    await expect(page.getByLabel("Agent name")).toHaveValue(shown);

    await expect(page.locator("main img")).toHaveCount(0);
    await expect(page.locator('[href*="evil.example"], [src*="evil.example"]')).toHaveCount(0);
    await expect(page.getByText("evil.example")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  });

  test("after answering a client on a custom scheme, the dialog says to close it and has no live Allow", async ({ page }) => {
    const client = await oauthClient(BASE_URL, { redirectUri: "cursor://anysphere.cursor-retrieval/oauth/callback", clientName: "Cursor" });
    await openDialog(page, client, "Cursor");
    await expect(page.getByText("cursor://anysphere.cursor-retrieval", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("You can close this window.")).toBeVisible();
    await expect(allow(page)).toHaveCount(0);
  });
});

test("a client connects with only the URL", async ({ page }) => {
  const workspace = await newWorkspace(page, "Oauth Co");
  const client = await oauthClient(BASE_URL);
  await openDialog(page, client);

  await test.step("the choices start where they should", async () => {
    await expect(page.getByLabel("Agent name")).toHaveValue("Scripted Client");
    // One workspace: nothing to pick between.
    await expect(page.getByRole("radio", { name: workspace.name })).toBeChecked();
    await expect(accessTo(page, workspace.name).getByRole("radio", { name: "Write" })).toBeChecked();
    await expect(page.getByRole("group", { name: "Access lasts" }).getByRole("radio", { name: "30 days" })).toBeChecked();
  });

  await test.step("Allow hands the client a working agent", async () => {
    await page.getByLabel("Agent name").fill("Laptop agent");
    await allow(page).click();
    const callback = await client.callback();
    expect(callback.searchParams.get("state")).toBe(OAUTH_CLIENT_STATE);
    expect(callback.searchParams.has("code")).toBe(true);

    const agent = await client.connect();
    const result = await agent.call("whoami");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ agent: { name: "Laptop agent" }, workspace: { slug: workspace.slug } });
    await agent.close();
  });

  await test.step("the agent is on the workspace's Agents page", async () => {
    await page.goto(`/w/${workspace.slug}/agents`);
    await expect(page.getByRole("row", { name: /Laptop agent/ })).toBeVisible();
  });

  await test.step("a client on a custom scheme gets a closing message after Allow, not a live button", async () => {
    const app = await oauthClient(BASE_URL, { redirectUri: "cursor://anysphere.cursor-retrieval/oauth/callback", clientName: "Cursor" });
    await openDialog(page, app, "Cursor");
    await allow(page).click();
    await expect(page.getByText("You can close this window.")).toBeVisible();
    await expect(allow(page)).toHaveCount(0);
  });
});

test("reusing a name warns before replacing the connection", async ({ page }) => {
  const workspace = await newWorkspace(page, "Renewals");
  const warning = page.getByText(REPLACES);

  const first = await oauthClient(BASE_URL);
  await openDialog(page, first);
  await expect(warning).toHaveCount(0);
  await allow(page).click();
  await first.callback();

  await test.step("the same client name warns as soon as the dialog opens, and only for that name", async () => {
    const again = await oauthClient(BASE_URL);
    await openDialog(page, again);
    await expect(warning).toBeVisible();
    await page.getByLabel("Agent name").fill("Another name");
    await expect(warning).toHaveCount(0);
    await page.getByLabel("Agent name").fill("Scripted Client");
    await expect(warning).toBeVisible();
  });

  await test.step("a typed name warns at Allow, and the second Allow replaces", async () => {
    const other = await oauthClient(BASE_URL, { clientName: "Other Client" });
    await openDialog(page, other, "Other Client");
    await page.getByLabel("Agent name").fill("Scripted Client");
    await expect(warning).toHaveCount(0);
    await allow(page).click();
    await expect(warning).toBeVisible();
    await expect(page).toHaveURL(/\/oauth\/approve/);
    await allow(page).click();

    const agent = await other.connect();
    expect((await agent.call("whoami")).structuredContent).toMatchObject({ agent: { name: "Scripted Client" }, workspace: { slug: workspace.slug } });
    await agent.close();
  });
});

test("a member is not offered Admin, and a posted level above their role is refused", async ({ page, browser }) => {
  test.slow();
  page.on("dialog", (dialog) => dialog.accept());
  const workspace = await newWorkspace(page, "Membership");
  const agentName = `Forged level ${runId()}`;

  await test.step("the demo account joins as a member", async () => {
    await openTab(page, workspace.slug, "Members");
    const panel = popover(card(page, "People"), "Invite");
    await panel.locator("summary").click();
    const form = panel.locator(":scope > div");
    await form.getByRole("textbox", { name: "Email" }).fill(DEMO_USER.email);
    await form.getByRole("combobox", { name: "Role" }).selectOption("member");
    await form.getByRole("button", { name: "Invite" }).click();
    const link = (await panel.locator("code").textContent())!.trim();

    const demo = await browser.newContext({ storageState: DEMO_SESSION });
    const theirs = await demo.newPage();
    await theirs.goto(link);
    await theirs.getByRole("button", { name: "Accept invitation" }).click();
    await expect(theirs).toHaveURL(`/w/${workspace.slug}`);
    await demo.close();
  });

  const demo = await browser.newContext({ storageState: DEMO_SESSION });
  try {
    const dialog = await demo.newPage();
    const client = await oauthClient(BASE_URL);
    await openDialog(dialog, client);

    await test.step("Admin is on the workspace they own, and absent where they are a member", async () => {
      await expect(accessTo(dialog, "Acme Corp").getByRole("radio", { name: "Admin" })).toHaveCount(1);
      await expect(accessTo(dialog, workspace.name).getByRole("radio", { name: "Write" })).toHaveCount(1);
      await expect(accessTo(dialog, workspace.name).getByRole("radio", { name: "Admin" })).toHaveCount(0);
    });

    await test.step("a forged Admin is refused, and no agent is made", async () => {
      await dialog.getByLabel("Agent name").fill(agentName);
      await dialog.getByRole("radio", { name: workspace.name }).check();
      await accessTo(dialog, workspace.name).getByRole("radio", { name: "Write" }).evaluate((radio: HTMLInputElement) => (radio.value = "admin"));
      await allow(dialog).click();
      await expect(dialog.getByRole("alert").filter({ hasText: "cannot grant Admin access" })).toBeVisible();
      await openTab(page, workspace.slug, "Agents");
      await expect(page.getByText(agentName)).toHaveCount(0);
    });
  } finally {
    await demo.close();
    await openTab(page, workspace.slug, "Members");
    const colleague = card(page, "People").getByRole("listitem").filter({ hasText: DEMO_USER.email });
    await colleague.getByRole("button", { name: "Remove" }).click();
    await expect(colleague).toHaveCount(0);
  }
});

test("no workspaces: create one, then return to the dialog", async ({ page }) => {
  await signUp(page, newPerson("Nora New"));
  const client = await oauthClient(BASE_URL);
  await openDialog(page, client);
  await expect(allow(page)).toHaveCount(0);

  const name = `First ${runId()}`;
  await page.getByLabel("Workspace name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page).toHaveURL(/\/oauth\/approve\?/);
  await expect(page.getByRole("radio", { name })).toBeChecked();
  expect(new URL(page.url()).searchParams.get("client_id")).toBe(client.clientId);
  await allow(page).click();
  expect((await client.callback()).searchParams.has("code")).toBe(true);
});
