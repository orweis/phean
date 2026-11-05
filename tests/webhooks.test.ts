import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { webhookDeliveries, webhooks } from "@/server/db/schema";
import { revokeAgent } from "@/server/domain/agents";
import type { Ctx } from "@/server/domain/context";
import { inTransaction } from "@/server/domain/context";
import { createGoal, setGoalStatus } from "@/server/domain/goals";
import { remember } from "@/server/domain/memory";
import { answerInput, captureTasks, requestInput, retractAnswer, updateTask } from "@/server/domain/tasks";
import { deleteWebhook, getWebhook, listWatches, pingWith, registerWebhook, unwatch, watch } from "@/server/domain/webhooks";
import { backoffSeconds, dispatchDue, MAX_CONSECUTIVE_FAILURES, type DispatchDeps, type WebhookPayload } from "@/server/webhooks/dispatch";
import { SIGNATURE_HEADER, verifySignature } from "@/server/webhooks/signing";
import { setDispatchScheduler } from "@/server/webhooks/trigger";
import { assertWebhookUrlSafe, isPrivateAddress } from "@/server/webhooks/url-safety";

import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";

let testDb: TestDb;
let ws: Workspace;
let human: Ctx;
let scout: Ctx;
let closer: Ctx;

interface Received {
  url: string;
  headers: Headers;
  body: string;
  payload: WebhookPayload;
}

/** A fake receiver: records every request and answers with `status` (or throws `error`). */
function receiver(respond: (request: Received) => number = () => 200) {
  const received: Received[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = String(init!.body);
    const request = { url: String(url), headers: new Headers(init!.headers), body, payload: JSON.parse(body) as WebhookPayload };
    received.push(request);
    return new Response(null, { status: respond(request) });
  }) as unknown as typeof globalThis.fetch;
  const deps: DispatchDeps = { fetch, resolve: async () => ["93.184.216.34"], allowPrivate: true, baseUrl: "https://phean.test", budgetMs: 5_000 };
  return { received, deps };
}

let urlCounter = 0;
const endpoint = () => `https://hooks.example.com/${ws.tenant.slug}/${++urlCounter}`;
const mine = (received: Received[], url: string) => received.filter((request) => request.url === url);
const eventsTo = (received: Received[], url: string) => mine(received, url).flatMap((request) => request.payload.events);

beforeAll(async () => {
  testDb = await createTestDb();
  vi.stubEnv("PHEAN_WEBHOOK_ALLOW_PRIVATE", "1");
});

beforeEach(async () => {
  ws = await seedWorkspace(testDb.db);
  ({ human } = ws);
  scout = ws.scout.ctx;
  closer = ws.closer.ctx;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

const todo = async (ctx: Ctx, title: string) => (await captureTasks(ctx, { tasks: [{ title, status: "todo" }] })).created[0]!;

describe("what an agent follows", () => {
  it("follows what it works on, and what it asks to", async () => {
    const task = await todo(scout, "Renew the SSL certificate");
    const goal = await createGoal(scout, { title: "Keep the site up" });
    const fact = await remember(scout, { content: "Certificates renew through Let's Encrypt", kind: "fact" });
    const other = await todo(human, "Book the offsite");
    await watch(scout, { entityType: "task", entityId: other.id });

    const watched = await listWatches(scout, {});
    expect(watched.map((entry) => [entry.entityType, entry.title, entry.reason])).toEqual(
      expect.arrayContaining([
        ["task", "Renew the SSL certificate", "auto"],
        ["goal", "Keep the site up", "auto"],
        ["memory", "Certificates renew through Let's Encrypt", "auto"],
        ["task", "Book the offsite", "manual"],
      ]),
    );
    expect(await listWatches(closer, {})).toEqual([]);
    await expect(watch(scout, { entityType: "goal", entityId: "g_missing" })).rejects.toMatchObject({ code: "not_found" });
    expect(await unwatch(scout, { entityType: "task", entityId: other.id })).toEqual({ removed: true });
    expect((await listWatches(scout, { entityType: "memory" })).map((entry) => entry.entityId)).toEqual([fact.id]);
    await expect(watch(human, { entityType: "task", entityId: task.id })).rejects.toMatchObject({ code: "invalid" });
    expect(goal.id).toMatch(/^g_/);
  });
});

describe("routing changes to webhooks", () => {
  it("queues, in the change's own transaction, what each agent follows and nothing it did itself", async () => {
    const url = endpoint();
    await registerWebhook(scout, { url });
    const goal = await createGoal(human, { title: "Close Q3" });
    await watch(scout, { entityType: "goal", entityId: goal.id });
    const task = await todo(scout, "Send the redlines");

    await updateTask(scout, { taskId: task.id, priority: "high" }); // its own change: not sent
    await updateTask(closer, { taskId: task.id, title: "Send the contract redlines" }); // a task it follows
    await captureTasks(closer, { tasks: [{ title: "Book the auditor", goalId: goal.id }] }); // filed under a goal it watches
    await captureTasks(closer, { tasks: [{ title: "Unrelated chore" }] }); // nothing to do with it
    await remember(closer, { content: "The auditor is Rivera & Co.", taskId: task.id }); // about a task it follows

    const { received, deps } = receiver();
    await dispatchDue(testDb.db, deps);
    const sent = eventsTo(received, url);
    expect(sent.map((event) => [event.action, event.reasons])).toEqual([
      ["task.updated", ["watching:task"]],
      ["task.captured", ["in_watched_goal"]],
      ["memory.saved", ["about_watched_task"]],
    ]);
    expect(sent[0]).toMatchObject({ entityId: task.id, actor: { name: "Closer" }, url: `https://phean.test/w/${ws.tenant.slug}/board` });
  });

  it("always tells the asking agent when a person answers, and nothing when the change rolls back", async () => {
    const url = endpoint();
    await registerWebhook(closer, { url, topics: ["decisions"] });
    const task = await todo(human, "Pick the auditor");
    await requestInput(closer, { taskId: task.id, kind: "decision", question: "Rivera or Okafor?", options: ["Rivera", "Okafor"] });
    await updateTask(human, { taskId: task.id, priority: "urgent" }); // a task change, but closer only takes decisions

    await expect(
      inTransaction(human, async (tx) => {
        await answerInput(tx, { taskId: task.id, answer: "Rivera" });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    await answerInput(human, { taskId: task.id, answer: "Okafor" });

    const { received, deps } = receiver();
    await dispatchDue(testDb.db, deps);
    const [answered, ...rest] = eventsTo(received, url);
    expect(rest).toEqual([]);
    expect(answered).toMatchObject({ action: "task.input_answered", reasons: expect.arrayContaining(["asked_by_you"]), data: expect.objectContaining({ answer: "Okafor" }), url: `https://phean.test/w/${ws.tenant.slug}/decisions` });
  });

  it("tells the asking agent when a person takes an answer back, which reopens its question", async () => {
    const url = endpoint();
    await registerWebhook(closer, { url, topics: ["decisions"] });
    const task = await todo(human, "Pick the bank");
    await requestInput(closer, { taskId: task.id, kind: "decision", question: "Northwind or Contoso?", options: ["Northwind", "Contoso"] });
    const { inputAnswers } = await answerInput(human, { taskId: task.id, answer: "Northwind" });
    await retractAnswer(human, { taskId: task.id, requestId: inputAnswers[0]!.id });

    const { received, deps } = receiver();
    await dispatchDue(testDb.db, deps);
    expect(eventsTo(received, url).map((event) => [event.action, event.reasons.includes("asked_by_you")])).toEqual([
      ["task.input_answered", true],
      ["task.input_retracted", true],
    ]);
  });

  it("tells a goal's proposer when a person decides on it, and can follow the whole workspace", async () => {
    const proposerUrl = endpoint();
    const everythingUrl = endpoint();
    await registerWebhook(scout, { url: proposerUrl, topics: ["decisions"] });
    await registerWebhook(closer, { url: everythingUrl, scope: "all", topics: ["goals", "tasks"] });
    const goal = await createGoal(scout, { title: "Renew vendor contracts" });
    await setGoalStatus(human, { goalId: goal.id, status: "active" });
    await todo(human, "Call the vendor");

    const { received, deps } = receiver();
    await dispatchDue(testDb.db, deps);
    expect(eventsTo(received, proposerUrl).map((event) => [event.action, event.reasons])).toEqual([["goal.approved", ["watching:goal"]]]);
    expect(eventsTo(received, everythingUrl).map((event) => [event.action, event.reasons])).toEqual([
      ["goal.proposed", ["workspace"]],
      ["goal.approved", ["workspace"]],
      ["task.captured", ["workspace"]],
    ]);
  });

  it("stops when the agent is revoked or removes its webhook", async () => {
    const url = endpoint();
    await registerWebhook(scout, { url });
    const task = await todo(scout, "Draft the newsletter");
    await revokeAgent(human, { agentId: ws.scout.agentId });
    await updateTask(human, { taskId: task.id, title: "Draft the October newsletter" });
    expect((await getWebhook(human, { agentId: ws.scout.agentId })).webhook).toMatchObject({ status: "disabled", disabledReason: "The agent was revoked." });

    await registerWebhook(closer, { url: endpoint() });
    await expect(deleteWebhook(scout, { agentId: ws.closer.agentId })).rejects.toMatchObject({ code: "invalid" });
    expect(await deleteWebhook(human, { agentId: ws.closer.agentId })).toEqual({ removed: true });
    expect((await getWebhook(closer, {})).webhook).toBeNull();

    const { received, deps } = receiver();
    await dispatchDue(testDb.db, deps);
    expect(mine(received, url)).toEqual([]);
  });
});

describe("delivering", () => {
  it("wakes the dispatcher only after the change commits", async () => {
    const kicks: number[] = [];
    setDispatchScheduler(() => kicks.push(Date.now()));
    try {
      await registerWebhook(scout, { url: endpoint() });
      const task = await todo(scout, "Order new laptops");
      await expect(
        inTransaction(human, async (tx) => {
          await updateTask(tx, { taskId: task.id, title: "Order laptops" });
          expect(kicks).toHaveLength(0);
          throw new Error("rolled back");
        }),
      ).rejects.toThrow();
      expect(kicks).toHaveLength(0);
      await updateTask(human, { taskId: task.id, title: "Order laptops for the new hires" });
      expect(kicks).toHaveLength(1);
    } finally {
      setDispatchScheduler(() => undefined);
    }
  });

  it("signs each batch, keeps order, and says which delivery it is", async () => {
    const url = endpoint();
    const { secret } = await registerWebhook(scout, { url });
    const task = await todo(scout, "Plan the launch");
    for (const title of ["Plan the launch event", "Plan the launch party", "Plan the launch week"]) await updateTask(human, { taskId: task.id, title });

    const { received, deps } = receiver();
    expect(await dispatchDue(testDb.db, deps)).toMatchObject({ delivered: expect.any(Number), failed: 0 });
    const [request, ...more] = mine(received, url);
    expect(more).toEqual([]);
    expect(verifySignature(secret, request!.body, request!.headers.get(SIGNATURE_HEADER)!)).toBe(true);
    expect(verifySignature("whsec_wrong", request!.body, request!.headers.get(SIGNATURE_HEADER)!)).toBe(false);
    expect(verifySignature(secret, `${request!.body} `, request!.headers.get(SIGNATURE_HEADER)!)).toBe(false);
    expect(request!.headers.get("Phean-Delivery-Id")).toBe(request!.payload.deliveryId);
    expect(request!.payload).toMatchObject({ type: "phean.events", workspace: { slug: ws.tenant.slug }, agent: { name: "Scout" } });
    expect(request!.payload.events.map((event) => event.data.changed)).toEqual([["title"], ["title"], ["title"]]);
    const ids = request!.payload.events.map((event) => event.eventId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    expect((await getWebhook(scout, {})).counts).toMatchObject({ pending: 0, delivered: 3 });
    const again = receiver();
    await dispatchDue(testDb.db, again.deps);
    expect(mine(again.received, url)).toEqual([]);
  });

  it("never sends a webhook's events twice when dispatchers run at once", async () => {
    const url = endpoint();
    await registerWebhook(scout, { url });
    const task = await todo(scout, "Migrate the CRM");
    for (const priority of ["high", "urgent", "low"] as const) await updateTask(human, { taskId: task.id, priority });
    const { received, deps } = receiver();
    await Promise.all([dispatchDue(testDb.db, deps), dispatchDue(testDb.db, deps), dispatchDue(testDb.db, deps)]);
    expect(eventsTo(received, url)).toHaveLength(3);
  });

  it("backs off after a failure, retries the same events, and gives up after too many", async () => {
    const url = endpoint();
    await registerWebhook(scout, { url });
    const task = await todo(scout, "Fix the login bug");
    await updateTask(human, { taskId: task.id, priority: "urgent" });

    const failing = receiver(() => 503);
    await dispatchDue(testDb.db, failing.deps);
    await dispatchDue(testDb.db, failing.deps); // backing off: not tried again yet
    expect(mine(failing.received, url)).toHaveLength(1);
    let status = await getWebhook(scout, {});
    expect(status.webhook).toMatchObject({ status: "active", consecutiveFailures: 1, lastStatus: 503, lastError: "HTTP 503" });
    expect(status.webhook!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    const backOffOver = () => testDb.db.update(webhooks).set({ nextAttemptAt: sql`now() - interval '1 second'` }).where(eq(webhooks.url, url));
    await backOffOver();
    const working = receiver();
    await dispatchDue(testDb.db, working.deps);
    expect(eventsTo(working.received, url).map((event) => event.action)).toEqual(["task.updated"]);
    status = await getWebhook(scout, {});
    expect(status.webhook).toMatchObject({ consecutiveFailures: 0, lastError: null });
    expect(status.recent[0]).toMatchObject({ status: "delivered", attempts: 2 });

    await updateTask(human, { taskId: task.id, title: "Fix the SSO login bug" });
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_FAILURES; attempt++) {
      await backOffOver();
      await dispatchDue(testDb.db, failing.deps);
    }
    status = await getWebhook(scout, {});
    expect(status.webhook).toMatchObject({ status: "disabled", consecutiveFailures: MAX_CONSECUTIVE_FAILURES });
    expect(status.webhook!.disabledReason).toContain("12 failed deliveries");
    expect(status.counts).toMatchObject({ pending: 0, dead: 1 });

    // Registering again re-enables it and rotates the secret.
    const { webhook } = await registerWebhook(scout, { url });
    expect(webhook).toMatchObject({ status: "active", consecutiveFailures: 0, disabledReason: null });
  });

  it("does not follow redirects, and treats them as failures", async () => {
    const url = endpoint();
    await registerWebhook(scout, { url });
    await updateTask(human, { taskId: (await todo(scout, "Rotate the API keys")).id, priority: "high" });
    const redirecting = receiver(() => 302);
    await dispatchDue(testDb.db, redirecting.deps);
    expect(redirecting.received.find((request) => request.url === url)).toBeDefined();
    expect((redirecting.deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.every(([, init]) => (init as RequestInit).redirect === "manual")).toBe(true);
    expect((await getWebhook(scout, {})).webhook).toMatchObject({ lastStatus: 302, consecutiveFailures: 1 });
  });

  it("sends the endpoint's own headers with every request, and never shows their values", async () => {
    const url = endpoint();
    const { webhook } = await registerWebhook(scout, { url, headers: { Authorization: "Bearer endpoint-key-123", "X-Team": "ops" } });
    expect(webhook.headerNames).toEqual(["Authorization", "X-Team"]);
    const status = await getWebhook(scout, {});
    expect(JSON.stringify(status)).not.toContain("endpoint-key-123");
    expect(status.webhook!.headerNames).toEqual(["Authorization", "X-Team"]);

    await updateTask(human, { taskId: (await todo(scout, "Renew the domain")).id, priority: "high" });
    const { received, deps } = receiver();
    await dispatchDue(testDb.db, deps);
    await pingWith(scout, deps);
    const sent = mine(received, url);
    expect(sent.map((request) => request.payload.type)).toEqual(["phean.events", "phean.ping"]);
    for (const request of sent) {
      expect(request.headers.get("authorization")).toBe("Bearer endpoint-key-123");
      expect(request.headers.get("x-team")).toBe("ops");
      expect(request.headers.get(SIGNATURE_HEADER)).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      expect(request.headers.get("content-type")).toBe("application/json");
    }

    // Registering again (say, to rotate the secret) keeps them; {} removes them.
    expect((await registerWebhook(scout, { url })).webhook.headerNames).toEqual(["Authorization", "X-Team"]);
    expect((await registerWebhook(scout, { url, headers: {} })).webhook.headerNames).toEqual([]);
    const after = receiver();
    await pingWith(scout, after.deps);
    expect(mine(after.received, url)[0]!.headers.get("authorization")).toBeNull();
  });

  it("refuses headers Phean sets itself, and malformed ones", async () => {
    for (const headers of [
      { "Content-Type": "text/plain" },
      { host: "evil.example" },
      { "Phean-Signature": "t=1,v1=00" },
      { "Bad Name": "x" },
      { Authorization: "Bearer a\r\nX-Injected: 1" },
      { Authorization: "a", authorization: "b" },
      Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`X-H${i}`, "v"])),
    ]) {
      await expect(registerWebhook(scout, { url: endpoint(), headers }), JSON.stringify(headers)).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("pings the endpoint on request", async () => {
    const url = endpoint();
    const { secret } = await registerWebhook(scout, { url });
    const { received, deps } = receiver();
    const result = await pingWith(scout, deps);
    expect(result).toMatchObject({ ok: true, status: 200, webhookStatus: "active" });
    const [ping] = mine(received, url);
    expect(ping!.payload).toMatchObject({ type: "phean.ping", events: [] });
    expect(verifySignature(secret, ping!.body, ping!.headers.get(SIGNATURE_HEADER)!)).toBe(true);
    expect((await getWebhook(scout, {})).webhook).toMatchObject({ consecutiveFailures: 0 });
  });
});

describe("webhook URLs", () => {
  const publicDns = async () => ["93.184.216.34"];
  const options = (resolve = publicDns) => ({ allowPrivate: false, resolve });

  it("only accepts https URLs on public hosts", async () => {
    await expect(assertWebhookUrlSafe("https://hooks.example.com/phean", options())).resolves.toBeInstanceOf(URL);
    for (const url of [
      "http://hooks.example.com/phean",
      "https://user:pass@hooks.example.com/",
      "https://localhost:8080/",
      "https://metadata.google.internal/",
      "https://127.0.0.1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/",
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://[::ffff:192.168.1.1]/",
      "ftp://hooks.example.com/",
      "not a url",
    ]) {
      await expect(assertWebhookUrlSafe(url, options()), url).rejects.toThrow();
    }
    await expect(assertWebhookUrlSafe("https://sneaky.example.com/", options(async () => ["93.184.216.34", "10.1.2.3"]))).rejects.toThrow(/private/);
  });

  it("classifies addresses", () => {
    expect(["8.8.8.8", "2606:4700::1111"].map(isPrivateAddress)).toEqual([false, false]);
    expect(["172.16.0.1", "172.31.255.255", "192.168.0.1", "100.64.0.1", "0.0.0.0", "fe80::1"].map(isPrivateAddress)).toEqual([true, true, true, true, true, true]);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(["::ffff:c0a8:101", "::ffff:7f00:1", "::ffff:808:808"].map(isPrivateAddress)).toEqual([true, true, false]);
  });

  it("refuses unsafe URLs when registering", async () => {
    vi.stubEnv("PHEAN_WEBHOOK_ALLOW_PRIVATE", "0");
    try {
      await expect(registerWebhook(scout, { url: "https://127.0.0.1/hook" })).rejects.toMatchObject({ code: "invalid" });
      await expect(registerWebhook(scout, { url: "http://hooks.example.com/" })).rejects.toMatchObject({ code: "invalid" });
    } finally {
      vi.stubEnv("PHEAN_WEBHOOK_ALLOW_PRIVATE", "1");
    }
    await expect(registerWebhook(human, { url: endpoint() })).rejects.toMatchObject({ code: "invalid" });
  });

  it("backs off exponentially, capped at six hours", () => {
    expect([1, 2, 3, 4, 5, 6, 12].map(backoffSeconds)).toEqual([30, 120, 480, 1920, 7680, 21600, 21600]);
  });
});

describe("deliveries stay in their workspace", () => {
  it("never routes one workspace's changes to another's agents", async () => {
    const other = await seedWorkspace(testDb.db, { name: "Globex", owner: "Eli" });
    const url = endpoint();
    await registerWebhook(other.scout.ctx, { url, scope: "all" });
    await updateTask(human, { taskId: (await todo(scout, "Acme secret")).id, title: "Acme merger memo" });
    await expect(watch(other.scout.ctx, { entityType: "task", entityId: (await todo(scout, "Acme other")).id })).rejects.toMatchObject({ code: "not_found" });
    await expect(getWebhook(other.human, { agentId: ws.scout.agentId })).resolves.toMatchObject({ webhook: null });

    const { received, deps } = receiver();
    await dispatchDue(testDb.db, deps);
    expect(mine(received, url)).toEqual([]);
    const queued = await testDb.db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.tenantId, other.tenant.id)));
    expect(queued).toEqual([]);
  });
});
