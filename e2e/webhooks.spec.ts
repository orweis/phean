import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test } from "@playwright/test";

import { SIGNATURE_HEADER, verifySignature } from "../src/server/webhooks/signing";
import { newWorkspace } from "./support/accounts";
import { asAgent, issueToken } from "./support/agents";
import { card } from "./support/locators";
import { openTab } from "./support/navigation";

interface Delivery {
  headers: IncomingHttpHeaders;
  body: string;
  payload: { type: string; events: { action: string; entityId: string; reasons: string[]; data: Record<string, unknown> }[] };
}

/** A bot's endpoint: records every request Phean makes to it. */
async function startReceiver() {
  const deliveries: Delivery[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      deliveries.push({ headers: request.headers, body, payload: JSON.parse(body) });
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/phean`, host: `127.0.0.1:${port}`, deliveries, close: () => new Promise((resolve) => server.close(resolve)) };
}

/**
 * A bot registers a webhook and asks for a decision. When the person decides in Phean, the bot is
 * called within moments, with a signed event saying what was decided and why it was sent.
 */
test("a bot's webhook is called as soon as a person decides", async ({ page }) => {
  test.slow();
  const receiver = await startReceiver();
  try {
    const { slug } = await newWorkspace(page, "Hooli");
    await openTab(page, slug, "Agents");
    const token = await issueToken(page, "Ops bot");

    const { secret, taskId } = await asAgent(token, async (agent) => {
      const { secret } = await agent.call<{ secret: string }>("register_webhook", { url: receiver.url, topics: ["decisions"] });
      const { result } = await agent.call<{ result: { ok: boolean; status: number } }>("ping_webhook");
      expect(result).toMatchObject({ ok: true, status: 204 });
      const { created } = await agent.call<{ created: { id: string }[] }>("capture_tasks", { tasks: [{ title: "Choose the on-call tool", status: "todo" }] });
      await agent.call("request_input", {
        taskId: created[0]!.id,
        kind: "decision",
        question: "PagerDuty or Opsgenie for on-call?",
        options: ["PagerDuty", "Opsgenie"],
      });
      return { secret, taskId: created[0]!.id };
    });

    const [ping] = receiver.deliveries;
    expect(ping!.payload).toMatchObject({ type: "phean.ping", events: [] });
    expect(verifySignature(secret, ping!.body, String(ping!.headers[SIGNATURE_HEADER.toLowerCase()]))).toBe(true);

    await test.step("the person decides on the Decisions page", async () => {
      await page.goto(`/w/${slug}/decisions`);
      await card(page, "1 request waiting on you")
        .locator(`[data-task="${taskId}"]`)
        .getByRole("group", { name: "Answer with an option" })
        .getByRole("button", { name: "Opsgenie" })
        .click();
      await expect(card(page, "Nothing waiting on you")).toBeVisible();
    });

    await test.step("the bot is called within seconds, with a signed event", async () => {
      const decided = () => receiver.deliveries.find((delivery) => delivery.payload.type === "phean.events");
      await expect.poll(() => Boolean(decided()), { timeout: 10_000, intervals: [100, 250, 500] }).toBe(true);
      const delivery = decided()!;
      expect(verifySignature(secret, delivery.body, String(delivery.headers[SIGNATURE_HEADER.toLowerCase()]))).toBe(true);
      expect(delivery.payload.events).toEqual([
        expect.objectContaining({ action: "task.input_answered", entityId: taskId, reasons: expect.arrayContaining(["asked_by_you"]), data: expect.objectContaining({ answer: "Opsgenie" }) }),
      ]);
    });

    await test.step("people see the webhook and its health on the Agents page", async () => {
      await openTab(page, slug, "Agents");
      const row = page.getByRole("row").filter({ hasText: "Ops bot" });
      await expect(row).toContainText("Delivering");
      await expect(row).toContainText(receiver.host);
      page.once("dialog", (dialog) => dialog.accept());
      await row.getByRole("button", { name: "Remove webhook" }).click();
      await expect(row).toContainText("None");
    });
  } finally {
    await receiver.close();
  }
});
