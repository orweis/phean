import { expect, type Page } from "@playwright/test";

import { connectAgent, type ConnectedAgent } from "../../scripts/mcp-agent";
import { BASE_URL } from "./env";

/** Issues a token on the open Agents page and reads it from the one-time reveal. */
export async function issueToken(page: Page, agentName: string): Promise<string> {
  await page.getByLabel("Agent name").fill(agentName);
  await page.getByRole("button", { name: "Issue token" }).click();
  const reveal = page.locator("code").filter({ hasText: /^phn_/ });
  await expect(reveal).toBeVisible();
  return (await reveal.textContent())!.trim();
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
