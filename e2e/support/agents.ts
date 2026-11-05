import { expect, type Page } from "@playwright/test";

import { connectAgent, type ConnectedAgent } from "../../scripts/mcp-agent";
import { BASE_URL } from "./env";
import { popover } from "./locators";
import { oauthClient } from "./oauth-client";

/** The quiet control on the Agents page that issues a fixed key, for a bot that cannot sign in through a browser. */
export const FIXED_KEY_TRIGGER = "Key for a bot";

/** Issues a fixed key on the open Agents page and reads it from the one-time reveal. */
export async function issueToken(page: Page, agentName: string): Promise<string> {
  const panel = popover(page, FIXED_KEY_TRIGGER);
  if (!(await panel.evaluate((details) => (details as HTMLDetailsElement).open))) await panel.locator("summary").click();
  await panel.getByLabel("Agent name").fill(agentName);
  await panel.getByRole("button", { name: "Issue key" }).click();
  const reveal = panel.locator("code").filter({ hasText: /^phn_/ });
  await expect(reveal).toBeVisible();
  return (await reveal.textContent())!.trim();
}

/** A row of the Agents page's table, by the agent's name. */
export const agentRow = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });

/** Approves a scripted OAuth client in this browser, at a level and lifetime, and waits until the client has its answer. */
export async function approveClient(page: Page, workspace: string, name: string, level = "Write", lasts = "30 days"): Promise<void> {
  const client = await oauthClient(BASE_URL);
  await page.goto(client.authorizationUrl);
  await page.getByLabel("Agent name").fill(name);
  // Choosing a level also chooses its workspace.
  await page.getByRole("group", { name: `Access to ${workspace}` }).getByText(level, { exact: true }).click();
  await page.getByRole("group", { name: "Access lasts" }).getByText(lasts, { exact: true }).click();
  await page.getByRole("button", { name: "Allow" }).click();
  expect((await client.callback()).searchParams.has("code")).toBe(true);
  // The browser lands on the client's receiver; let it finish before the page goes anywhere else.
  await expect(page.getByText("Connected. You can close this window.")).toBeVisible();
  client.close();
}

/** Connects to the MCP endpoint as the token's agent for the length of `work`. */
export async function asAgent<T>(token: string, work: (agent: ConnectedAgent) => Promise<T>): Promise<T> {
  const agent = await connectAgent(BASE_URL, token, "phean-e2e-agent");
  try {
    return await work(agent);
  } finally {
    await agent.client.close();
  }
}
