import { expect, test } from "@playwright/test";

import { DEMO_USER } from "../scripts/demo-account";
import { connectAgent } from "../scripts/mcp-agent";
import { newWorkspace } from "./support/accounts";
import { agentRow, approveClient, asAgent, FIXED_KEY_TRIGGER, issueToken } from "./support/agents";
import { BASE_URL, DEMO_SESSION } from "./support/env";
import { card, popover } from "./support/locators";
import { openTab } from "./support/navigation";

/**
 * What an owner does besides reading status: connect agents, decide on and edit goals, keep shared
 * memory, search, cut off an agent, and bring in a colleague (the seeded demo account, in a browser
 * of its own). One test, because sign-ups are rate limited.
 */
test("an owner manages goals, memory, search, agents and members", async ({ page, browser }) => {
  test.slow();
  const workspace = await newWorkspace(page, "Hooli");
  const { slug } = workspace;
  // Revoking, abandoning, forgetting and removing ask first.
  page.on("dialog", (dialog) => dialog.accept());
  let token = "";
  let goalId = "";

  await test.step("an owner issues a fixed key from the quiet control", async () => {
    await openTab(page, slug, "Agents");
    // The page leads with signing in: the keyless snippet is open, the key is behind a quiet control.
    await page.getByRole("group", { name: "Client" }).getByRole("button", { name: "Claude Code" }).click();
    await expect(page.getByText(`claude mcp add --transport http phean-${slug} ${BASE_URL}/mcp`, { exact: true })).toBeVisible();
    const keys = popover(page, FIXED_KEY_TRIGGER);
    await expect(keys.getByRole("button", { name: "Issue key" })).toBeHidden();
    token = await issueToken(page, "Night shift");
    // Today's reveal: the key once, with snippets that carry it.
    await expect(keys.getByRole("tablist", { name: "MCP client" }).getByRole("tab")).toHaveCount(3);
    await expect(keys.getByRole("tabpanel")).toContainText(`Bearer ${token}`);
    await expect(keys.getByText("cannot be shown again")).toBeVisible();
  });

  await test.step("an agent connects and proposes a goal", async () => {
    goalId = await asAgent(token, async (agent) => {
      const { goal } = await agent.call<{ goal: { id: string } }>("create_goal", { title: "Renew vendor contracts" });
      return goal.id;
    });
  });

  await test.step("the agents table shows connection type, level and end date", async () => {
    await approveClient(page, workspace.name, "Laptop agent", "Read", "7 days");
    await page.goto(`/w/${slug}/agents`);
    const key = agentRow(page, "Night shift");
    await expect(key).toContainText("Fixed key");
    await expect(key).toContainText("Write");
    await expect(key).toContainText("No end date");

    const signedIn = agentRow(page, "Laptop agent");
    const end = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.now() + 7 * 24 * 3600 * 1000));
    await expect(signedIn).toContainText("OAuth sign-in");
    await expect(signedIn).toContainText("Read");
    await expect(signedIn).toContainText(`Ends ${end}`);
    await expect(signedIn.getByRole("button", { name: "Revoke" })).toBeVisible();
  });

  await test.step("the owner edits the goal, then approves, abandons and reactivates it", async () => {
    await page.goto(`/w/${slug}/goals/${goalId}`);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText("Renew vendor contracts");

    const edit = popover(page, "Edit");
    await edit.locator("summary").click();
    await edit.getByLabel("Title").fill("Renew the vendor contracts");
    await edit.getByLabel("Description").fill("Every contract that lapses this year.");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(heading).toHaveText("Renew the vendor contracts");
    await expect(page.getByRole("paragraph").filter({ hasText: "Every contract that lapses this year." })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: "Abandon" }).click();
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByRole("button", { name: "Mark achieved" })).toBeVisible();
    await expect(card(page, "Activity")).toContainText("reactivated goal");
    await expect(card(page, "Activity")).toContainText("abandoned goal");
  });

  await test.step("remember a choice and filter memory by kind", async () => {
    await openTab(page, slug, "Memory");
    const form = popover(card(page, "Everything remembered"), "Add");
    await form.locator("summary").click();
    await form.getByRole("textbox", { name: "What should agents remember?" }).fill("Vendor contracts renew on the first of the month.");
    await form.getByRole("combobox", { name: "Kind" }).selectOption("decision");
    await form.getByRole("textbox", { name: "Tags" }).fill("vendors, legal");
    await form.getByRole("combobox", { name: "About goal" }).selectOption({ label: "Renew the vendor contracts" });
    await form.getByRole("button", { name: "Remember" }).click();
    await expect(page.locator("[data-status-region]")).toContainText("Saved to memory");

    const remembered = card(page, "Everything remembered").getByRole("listitem").filter({ hasText: "Vendor contracts renew" });
    await expect(remembered).toContainText("#vendors");
    await expect(remembered.getByRole("link", { name: "Renew the vendor contracts" })).toBeVisible();

    const kinds = page.getByRole("navigation", { name: "Filter by kind" });
    await expect(kinds.getByRole("link", { name: /^Choice/ })).toHaveText("Choice1");
    await kinds.getByRole("link", { name: /^Choice/ }).click();
    await expect(card(page, "1 match")).toContainText("Vendor contracts renew");
    await kinds.getByRole("link", { name: /^Fact/ }).click();
    await expect(page.getByText("No memories match")).toBeVisible();
  });

  await test.step("search finds the goal and the memory, and links to them", async () => {
    await openTab(page, slug, "Search");
    await page.getByRole("searchbox", { name: "Search" }).fill("vendor");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/w/${slug}/search?q=vendor`);
    await expect(card(page, "Memories")).toContainText("Vendor contracts renew");
    await card(page, "Goals").getByRole("link", { name: /Renew the vendor contracts/ }).click();
    await expect(page).toHaveURL(`/w/${slug}/goals/${goalId}`);

    await page.goto(`/w/${slug}/search?q=zeppelin`);
    await expect(page.getByText('Nothing matches "zeppelin"')).toBeVisible();
  });

  await test.step("correct the memory in place", async () => {
    await openTab(page, slug, "Memory");
    const row = card(page, "Everything remembered").getByRole("listitem").filter({ hasText: "Vendor contracts renew" });
    const edit = row.locator("details").filter({ has: page.locator('summary[aria-label^="Edit"]') });
    await edit.locator("summary").click();
    await edit.getByRole("textbox", { name: "What agents remember" }).fill("Vendor contracts renew on the fifteenth.");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("[data-status-region]")).toContainText("Saved the memory");
    await expect(card(page, "Everything remembered")).toContainText("Vendor contracts renew on the fifteenth.");
  });

  await test.step("forget the memory", async () => {
    await openTab(page, slug, "Memory");
    await card(page, "Everything remembered").getByRole("button", { name: "Forget" }).click();
    await expect(page.getByText("Nothing remembered yet")).toBeVisible();
  });

  await test.step("an agent's sub-agent shows under it, and revoking the agent cuts both off at once", async () => {
    const helper = await asAgent(token, (agent) => agent.call<{ subagent: { id: string }; token: string }>("create_subagent", { name: "Researcher", purpose: "Reads vendor contracts" }));
    // A worker on the agent's own key, naming itself, shows up under it without a token of its own.
    const worker = await connectAgent(BASE_URL, token, "phean-e2e-worker", "Clause checker");
    await worker.call("whoami");
    await worker.client.close();
    await openTab(page, slug, "Agents");
    await expect(page.getByRole("row").filter({ hasText: "Clause checker" })).toContainText("Detected · shares Night shift's key");
    // The connect form folds to a bar once agents exist; the agents lead the page.
    await expect(page.getByRole("button", { name: "Connect an agent" })).toHaveAttribute("aria-expanded", "false");
    const row = page.getByRole("row").filter({ hasText: "Night shift" }).filter({ hasNotText: "Researcher" }).filter({ hasNotText: "Clause checker" });
    const sub = page.locator(`tr[data-agent="${helper.subagent.id}"]`);
    await expect(sub).toContainText("Reads vendor contracts");
    await expect(sub).toContainText("sub-agent of Night shift");
    await expect(row).toContainText("Runs 2 sub-agents");
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toContainText("Revoked");
    await expect(sub).toContainText("Revoked");
    await expect(page.getByRole("row").filter({ hasText: "Clause checker" })).toContainText("Revoked");
    await expect(connectAgent(BASE_URL, helper.token, "revoked helper")).rejects.toThrow();
    await expect(row.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    await expect(connectAgent(BASE_URL, token, "revoked")).rejects.toThrow();
  });

  await test.step("invite a colleague, and cancel an invitation sent by mistake", async () => {
    await openTab(page, slug, "Members");
    const invitePanel = popover(card(page, "People"), "Invite");
    await invitePanel.locator("summary").click();
    const form = invitePanel.locator(":scope > div");
    const invite = async (email: string, role: "member" | "admin") => {
      if (!(await invitePanel.evaluate((details) => (details as HTMLDetailsElement).open))) await invitePanel.locator("summary").click();
      await form.getByRole("textbox", { name: "Email" }).fill(email);
      await form.getByRole("combobox", { name: "Role" }).selectOption(role);
      await form.getByRole("button", { name: "Invite" }).click();
      await expect(form.getByText(`Send this link to ${email}`)).toBeVisible();
    };
    const pending = card(page, "Pending invitations");

    await invite("typo@example.com", "member");
    await page.keyboard.press("Escape");
    await pending.getByRole("listitem").filter({ hasText: "typo@example.com" }).getByRole("button", { name: "Cancel" }).click();
    await expect(pending.getByRole("listitem").filter({ hasText: "typo@example.com" })).toHaveCount(0);

    await invite(DEMO_USER.email, "admin");
    await expect(pending.getByRole("listitem").filter({ hasText: DEMO_USER.email })).toContainText("Admin");
  });

  await test.step("the colleague accepts the link in their own browser", async () => {
    const link = (await popover(card(page, "People"), "Invite").locator("code").textContent())!.trim();
    const colleague = await browser.newContext({ storageState: DEMO_SESSION });
    try {
      const theirs = await colleague.newPage();
      await theirs.goto(link);
      await expect(theirs.getByRole("heading", { level: 1 })).toHaveText(`Join ${workspace.name}`);
      await expect(theirs.getByText(`${workspace.owner.name} invited you to join as admin.`)).toBeVisible();
      await theirs.getByRole("button", { name: "Accept invitation" }).click();
      await expect(theirs).toHaveURL(`/w/${slug}`);
    } finally {
      await colleague.close();
    }
  });

  await test.step("the owner sees the new admin, and removes them again", async () => {
    await page.reload();
    const colleague = card(page, "People").getByRole("listitem").filter({ hasText: DEMO_USER.email });
    await expect(colleague).toContainText("Admin");
    await expect(card(page, "Pending invitations")).toHaveCount(0);
    await colleague.getByRole("button", { name: "Remove" }).click();
    await expect(colleague).toHaveCount(0);
  });
});
