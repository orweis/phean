import { expect, test } from "@playwright/test";

import { DEMO_USER } from "../scripts/demo-account";
import { connectAgent } from "../scripts/mcp-agent";
import { newWorkspace } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { BASE_URL, DEMO_SESSION } from "./support/env";
import { card, popover } from "./support/locators";
import { openTab } from "./support/navigation";

/**
 * What an owner does besides reading status: decide on and edit goals, keep shared memory, search,
 * cut off an agent, and bring in a colleague (the seeded demo account, in a browser of its own).
 */
test("an owner manages goals, memory, search, agents and members", async ({ page, browser }) => {
  test.slow();
  const workspace = await newWorkspace(page, "Hooli");
  const { slug } = workspace;
  // Revoking, abandoning, forgetting and removing ask first.
  page.on("dialog", (dialog) => dialog.accept());
  let token = "";
  let goalId = "";

  await test.step("an agent connects and proposes a goal", async () => {
    await openTab(page, slug, "Agents");
    token = await issueToken(page, "Night shift");
    goalId = await asAgent(token, async (agent) => {
      const { goal } = await agent.call<{ goal: { id: string } }>("create_goal", { title: "Renew vendor contracts" });
      return goal.id;
    });
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

  await test.step("remember a decision and filter memory by kind", async () => {
    await openTab(page, slug, "Memory");
    const form = card(page, "Remember something");
    await form.getByRole("textbox", { name: "What should agents remember?" }).fill("Vendor contracts renew on the first of the month.");
    await form.getByRole("combobox", { name: "Kind" }).selectOption("decision");
    await form.getByRole("textbox", { name: "Tags" }).fill("vendors, legal");
    await form.getByRole("combobox", { name: "About goal" }).selectOption({ label: "Renew the vendor contracts" });
    await form.getByRole("button", { name: "Remember" }).click();

    const remembered = card(page, "Everything remembered").getByRole("listitem").filter({ hasText: "Vendor contracts renew" });
    await expect(remembered).toContainText("#vendors");
    await expect(remembered.getByRole("link", { name: "Renew the vendor contracts" })).toBeVisible();

    const kinds = page.getByRole("navigation", { name: "Filter by kind" });
    await kinds.getByRole("link", { name: "Decision" }).click();
    await expect(card(page, "1 match")).toContainText("Vendor contracts renew");
    await kinds.getByRole("link", { name: "Fact" }).click();
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

  await test.step("forget the memory", async () => {
    await openTab(page, slug, "Memory");
    await card(page, "Everything remembered").getByRole("button", { name: "Forget" }).click();
    await expect(page.getByText("Nothing remembered yet")).toBeVisible();
  });

  await test.step("revoking an agent cuts it off at once", async () => {
    await openTab(page, slug, "Agents");
    const row = page.getByRole("row").filter({ hasText: "Night shift" });
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toContainText("Revoked");
    await expect(row.getByRole("button", { name: "Revoke" })).toHaveCount(0);
    await expect(connectAgent(BASE_URL, token, "revoked")).rejects.toThrow();
  });

  await test.step("invite a colleague, and cancel an invitation sent by mistake", async () => {
    await openTab(page, slug, "Members");
    const form = card(page, "Invite someone");
    const invite = async (email: string, role: "member" | "admin") => {
      await form.getByRole("textbox", { name: "Email" }).fill(email);
      await form.getByRole("combobox", { name: "Role" }).selectOption(role);
      await form.getByRole("button", { name: "Invite" }).click();
      await expect(form.getByText(`Send this link to ${email}`)).toBeVisible();
    };
    const pending = card(page, "Pending invitations");

    await invite("typo@example.com", "member");
    await pending.getByRole("listitem").filter({ hasText: "typo@example.com" }).getByRole("button", { name: "Cancel" }).click();
    await expect(pending).not.toContainText("typo@example.com");

    await invite(DEMO_USER.email, "admin");
    await expect(pending.getByRole("listitem").filter({ hasText: DEMO_USER.email })).toContainText("Admin");
  });

  await test.step("the colleague accepts the link in their own browser", async () => {
    const link = (await card(page, "Invite someone").locator("code").textContent())!.trim();
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
    await expect(card(page, "Pending invitations")).toContainText("No open invitations.");
    await colleague.getByRole("button", { name: "Remove" }).click();
    await expect(colleague).toHaveCount(0);
  });
});
