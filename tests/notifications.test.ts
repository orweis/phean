import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { events, pushDeliveries, pushDevices } from "@/server/db/schema";
import { personContext, type Ctx } from "@/server/domain/context";
import {
  answerFromNotification,
  forgetDevice,
  listDevices,
  muteWorkspace,
  openDecisions,
  registerDevice,
  setDeviceOptions,
  unmuteWorkspace,
} from "@/server/domain/notifications";
import { answerInput, captureTasks, collectAnswers, completeTask, requestInput, resolveInput, retractAnswer } from "@/server/domain/tasks";
import { PUSH_GIVE_UP_MS, sendDuePushes } from "@/server/push/dispatch";
import { isPushServiceHost } from "@/server/push/endpoints";
import { PUSH_PAYLOAD_MAX_BYTES, requestPayload } from "@/server/push/payload";
import { setPushScheduler } from "@/server/push/trigger";
import type { InputRequest } from "@/lib/agent-sessions";

import { addMember, asUser, createTestDb, seedUser, seedWorkspace, type TestDb, type TestUser, type Workspace } from "./support/db";
import { deliveriesOf, deviceFor, fakePushService, publicResolver, subscription } from "./support/push";

let testDb: TestDb;
let ws: Workspace;
let dana: TestUser;
let sam: TestUser;
let samCtx: Ctx;

// The sender sweeps the whole outbox, so each test has a database of its own.
beforeEach(async () => {
  testDb = await createTestDb();
  ws = await seedWorkspace(testDb.db);
  dana = { id: ws.human.actor.id, name: ws.human.actor.name, email: "" };
  sam = await seedUser(testDb.db, "Sam");
  await addMember(testDb.db, ws.tenant, sam, "member");
  samCtx = asUser(testDb.db, ws.tenant, sam, "member");
});
afterEach(() => testDb.close());

async function ask(question = "Which auditor?", options = ["Okafor", "Lindqvist"], extra: { multiple?: boolean } = {}) {
  const { created } = await captureTasks(ws.scout.ctx, { tasks: [{ title: "Pick the auditor" }] });
  const task = await requestInput(ws.scout.ctx, { taskId: created[0]!.id, kind: "decision", question, options, ...extra });
  return { taskId: task.id, requestId: task.inputRequest!.id };
}

describe("devices", () => {
  it("registers a push subscription for the person, and ignores a session id posted with it", async () => {
    const ctx = personContext(testDb.db, dana);
    const posted = { ...subscription(), label: "Chrome on Android", sessionId: "s_forged", userId: sam.id };
    const device = await registerDevice(ctx, posted, { resolve: publicResolver });
    const [row] = await testDb.db.select().from(pushDevices).where(eq(pushDevices.id, device.id));
    expect(row).toMatchObject({ userId: dana.id, sessionId: null, label: "Chrome on Android", answerFromNotification: false, private: false });
    // Keys are stored encrypted, never as sent.
    expect(row!.p256dhCiphertext).not.toBe(posted.keys.p256dh);
    expect(row!.p256dhCiphertext.startsWith("v1.")).toBe(true);
    expect((await listDevices(ctx)).map((entry) => entry.id)).toEqual([device.id]);
  });

  it("accepts only the browsers' push services, over https, on public addresses, with keys of the right size", async () => {
    const ctx = personContext(testDb.db, dana);
    const register = (endpoint: string, overrides: Partial<ReturnType<typeof subscription>["keys"]> = {}, resolve = publicResolver) => {
      const sub = subscription(endpoint);
      return registerDevice(ctx, { ...sub, keys: { ...sub.keys, ...overrides } }, { resolve });
    };
    for (const endpoint of ["https://evil.example/push", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com:8443/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x", "not a url"]) {
      await expect(register(endpoint), endpoint).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(register("https://updates.push.services.mozilla.com/wpush/v2/x", {}, async () => ["10.0.0.5"])).rejects.toMatchObject({ code: "invalid" });
    await expect(register("https://web.push.apple.com/x", { p256dh: Buffer.alloc(33).toString("base64url") })).rejects.toMatchObject({ code: "invalid" });
    await expect(register("https://web.push.apple.com/x", { auth: Buffer.alloc(8).toString("base64url") })).rejects.toMatchObject({ code: "invalid" });
    await expect(register("https://wns2-par02p.notify.windows.com/w/?token=x")).resolves.toMatchObject({ label: "This browser" });
    expect(isPushServiceHost("push.apple.com")).toBe(false);
    expect(isPushServiceHost("web.push.apple.com")).toBe(true);
  });

  it("refuses someone who is a member of no workspace", async () => {
    const loner = await seedUser(testDb.db, "Loner");
    await expect(registerDevice(personContext(testDb.db, loner), subscription(), { resolve: publicResolver })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("moves a browser subscribed again onto the person signed in now, with its options reset and nothing queued for the one before", async () => {
    const shared = subscription();
    const before = await deviceFor(testDb.db, dana, { endpoint: shared.endpoint, answerFromNotification: true, private: true });
    await ask();
    // Dana's device has a request queued (Scout asked; Dana did not).
    expect(await deliveriesOf(testDb.db, before.id)).toHaveLength(1);

    const after = await registerDevice(personContext(testDb.db, sam), { ...shared, label: "Shared laptop" }, { resolve: publicResolver });
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({ answerFromNotification: false, private: false, label: "Shared laptop" });
    expect(await listDevices(personContext(testDb.db, dana))).toEqual([]);
    expect(await deliveriesOf(testDb.db, before.id)).toEqual([]);
  });

  it("forgets and changes only the person's own devices", async () => {
    const device = await deviceFor(testDb.db, dana);
    await expect(forgetDevice(personContext(testDb.db, sam), { deviceId: device.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(setDeviceOptions(personContext(testDb.db, sam), { deviceId: device.id, private: true })).rejects.toMatchObject({ code: "not_found" });

    const ctx = personContext(testDb.db, dana);
    await expect(setDeviceOptions(ctx, { deviceId: device.id, answerFromNotification: "true" })).resolves.toMatchObject({ answerFromNotification: true, private: false });
    await expect(setDeviceOptions(ctx, { deviceId: device.id, answerFromNotification: "true" })).rejects.toMatchObject({ code: "invalid" });
    await expect(setDeviceOptions(ctx, { deviceId: device.id, private: false })).rejects.toMatchObject({ code: "invalid" });
    await expect(forgetDevice(ctx, { deviceId: device.id })).resolves.toEqual({ label: "Chrome on Android" });
    expect(await listDevices(ctx)).toEqual([]);
  });
});

describe("routing", () => {
  it("queues a request push for every member with a device except one who muted the workspace, and wakes the sender once", async () => {
    const kicks: number[] = [];
    setPushScheduler(() => kicks.push(1));
    try {
      const danaDevice = await deviceFor(testDb.db, dana);
      const samDevice = await deviceFor(testDb.db, sam);
      await muteWorkspace(samCtx, {});
      const { requestId } = await ask();
      expect(kicks).toEqual([1]);
      expect(await deliveriesOf(testDb.db, danaDevice.id)).toEqual([expect.objectContaining({ kind: "request", requestId, status: "pending" })]);
      expect(await deliveriesOf(testDb.db, samDevice.id)).toEqual([]);

      await unmuteWorkspace(samCtx, {});
      await ask("Which bank?");
      expect(await deliveriesOf(testDb.db, samDevice.id)).toHaveLength(1);
    } finally {
      setPushScheduler(() => undefined);
    }
  });

  it("queues nothing, and wakes nothing, when no one has a device", async () => {
    const kicks: number[] = [];
    setPushScheduler(() => kicks.push(1));
    try {
      await ask();
      expect(kicks).toEqual([]);
    } finally {
      setPushScheduler(() => undefined);
    }
  });

  it("replaces the notification on the other devices once a person answers, and drops it where it was never sent", async () => {
    const push = fakePushService();
    const danaDevice = await deviceFor(testDb.db, dana);
    const samDevice = await deviceFor(testDb.db, sam);
    const { taskId, requestId } = await ask();
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.map((message) => message.body.type)).toEqual(["request", "request"]);

    await answerInput(ws.human, { taskId, answer: "Okafor" });
    // Dana answered: only Sam's device is told, and by whom.
    expect((await deliveriesOf(testDb.db, danaDevice.id)).map((row) => row.kind)).toEqual(["request"]);
    expect((await deliveriesOf(testDb.db, samDevice.id)).map((row) => row.kind)).toEqual(["request", "resolved"]);
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.at(-1)).toMatchObject({ topic: requestId, body: { v: 1, type: "resolved", slug: ws.tenant.slug, requestId, by: "Dana" } });

    // Dana takes the answer back: the request is open again, and Sam's device hears of it again.
    await retractAnswer(ws.human, { taskId, requestId });
    expect((await deliveriesOf(testDb.db, samDevice.id)).map((row) => row.kind)).toEqual(["request", "resolved", "request"]);
    expect(await deliveriesOf(testDb.db, danaDevice.id)).toHaveLength(1);
    // Sam answers before that push went out: it is dropped, with nothing to replace.
    await answerInput(samCtx, { taskId, answer: "Lindqvist" });
    const rows = await deliveriesOf(testDb.db, samDevice.id);
    expect(rows.map((row) => [row.kind, row.status])).toEqual([
      ["request", "sent"],
      ["resolved", "sent"],
      ["request", "dead"],
    ]);
    expect(await deliveriesOf(testDb.db, danaDevice.id)).toHaveLength(1);
  });

  it("resolves the push when the agent closes its question or the task is completed", async () => {
    const push = fakePushService();
    const device = await deviceFor(testDb.db, dana);
    const first = await ask();
    await sendDuePushes(testDb.db, push.deps);
    await resolveInput(ws.scout.ctx, { taskId: first.taskId });

    const second = await ask("Which bank?");
    await sendDuePushes(testDb.db, push.deps);
    await completeTask(ws.scout.ctx, { taskId: second.taskId });
    await sendDuePushes(testDb.db, push.deps);

    expect(push.sent.map((message) => [message.body.type, message.body.requestId, message.body.by ?? null])).toEqual([
      ["request", first.requestId, null],
      ["resolved", first.requestId, "Scout"],
      ["request", second.requestId, null],
      ["resolved", second.requestId, "Scout"],
    ]);
    // Each request is resolved once, however many changes follow.
    await captureTasks(ws.scout.ctx, { tasks: [{ title: "Unrelated" }] });
    expect((await deliveriesOf(testDb.db, device.id)).filter((row) => row.kind === "resolved")).toHaveLength(2);
  });
});

describe("answering", () => {
  it("answers with the open request's own label for an option index", async () => {
    const { taskId, requestId } = await ask();
    await expect(answerFromNotification(ws.human, { taskId, requestId, option: 1 })).resolves.toEqual({ answer: "Lindqvist", taskTitle: "Pick the auditor", agentName: "Scout" });
    expect(await collectAnswers(ws.scout.ctx, {})).toEqual([expect.objectContaining({ answer: "Lindqvist", outcome: "answered" })]);
  });

  it("takes a text reply, and refuses an option that is not there or a request that takes several answers", async () => {
    const one = await ask();
    await expect(answerFromNotification(ws.human, { ...one, option: 5 })).rejects.toMatchObject({ code: "invalid" });
    await expect(answerFromNotification(ws.human, { ...one, option: 0, answer: "both" } as never)).rejects.toMatchObject({ code: "invalid" });
    await expect(answerFromNotification(ws.human, { ...one, answer: "Neither, ask Kim" })).resolves.toMatchObject({ answer: "Neither, ask Kim" });

    const several = await ask("Which channels?", ["Slack", "Email"], { multiple: true });
    await expect(answerFromNotification(ws.human, { ...several, option: 0 })).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses a stale request id, and logs no answer", async () => {
    const { taskId, requestId } = await ask();
    const newer = await requestInput(ws.scout.ctx, { taskId, kind: "decision", question: "Okafor or Brandt?", options: ["Okafor", "Brandt"] });
    await expect(answerFromNotification(ws.human, { taskId, requestId, option: 0 })).rejects.toMatchObject({ code: "conflict" });
    await expect(answerInput(ws.human, { taskId, answer: "Okafor", requestId })).rejects.toMatchObject({ code: "conflict" });

    await answerInput(ws.human, { taskId, answer: "Brandt", requestId: newer.inputRequest!.id });
    // No open request at all is a conflict too.
    await expect(answerInput(ws.human, { taskId, answer: "Brandt", requestId: newer.inputRequest!.id })).rejects.toMatchObject({ code: "conflict" });
    const answered = await testDb.db.select({ data: events.data }).from(events).where(and(eq(events.entityId, taskId), eq(events.action, "task.input_answered")));
    expect(answered.map((row) => row.data.answer)).toEqual(["Brandt"]);
  });
});

describe("open decisions", () => {
  it("lists the workspace's open requests newest first, and says when it is muted", async () => {
    const first = await ask("Which auditor?");
    const second = await ask("Which bank?");
    const decisions = await openDecisions(ws.human, {});
    expect(decisions).toMatchObject({ pending: 2, muted: false });
    expect(decisions.items.map((item) => item.requestId)).toEqual([second.requestId, first.requestId]);
    expect(decisions.items[0]).toEqual({
      requestId: second.requestId,
      taskId: second.taskId,
      slug: ws.tenant.slug,
      workspaceName: "Acme",
      agentName: "Scout",
      kind: "decision",
      question: "Which bank?",
      options: ["Okafor", "Lindqvist"],
      multiple: false,
      askedAt: expect.any(String),
    });
    await muteWorkspace(ws.human, {});
    await expect(openDecisions(ws.human, {})).resolves.toMatchObject({ pending: 2, muted: true });
  });
});

describe("payload", () => {
  const request: InputRequest = {
    id: "q_0123456789ab",
    kind: "decision",
    question: "Which auditor?",
    context: "Secret context the agent wrote",
    options: ["Okafor", "Lindqvist", "Brandt"],
    links: [{ url: "https://example.com/thread", title: "Thread", kind: "source" }],
    agentId: "ag_1",
    agentName: "Scout",
    askedAt: new Date().toISOString(),
  };
  const workspace = { slug: "acme", name: "Acme" };

  it("carries the question, who asked and the first two options when the device answers from notifications", () => {
    expect(requestPayload(workspace, "t_1", request, { answerFromNotification: true, private: false })).toEqual({
      v: 1, type: "request", slug: "acme", workspaceName: "Acme", requestId: request.id, taskId: "t_1",
      agentName: "Scout", kind: "decision", question: "Which auditor?", options: ["Okafor", "Lindqvist"], answerable: true,
    });
    expect(requestPayload(workspace, "t_1", request, { answerFromNotification: false, private: false })).toMatchObject({ options: [], answerable: false });
    expect(requestPayload(workspace, "t_1", { ...request, multiple: true }, { answerFromNotification: true, private: false })).toMatchObject({ options: [], answerable: false });
  });

  it("gives a private device only that a decision waits, and where", () => {
    const payload = requestPayload(workspace, "t_1", request, { answerFromNotification: true, private: true });
    expect(payload).toEqual({ v: 1, type: "request", private: true, slug: "acme", workspaceName: "Acme", requestId: request.id, taskId: "t_1" });
    expect(JSON.stringify(payload)).not.toContain("auditor");
  });

  it("never carries the context, links or anything past 3 KB, however long the agent wrote", () => {
    const long = { ...request, question: "\u0001🪨".repeat(1000), options: ["\"".repeat(200), "é".repeat(200)], agentName: "x".repeat(80), viaAgentName: "🪨".repeat(80) };
    const payload = requestPayload({ slug: "a".repeat(40), name: "🪨".repeat(80) }, "t_1", long, { answerFromNotification: true, private: false });
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    expect(bytes).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
    expect(payload).toMatchObject({ type: "request", answerable: true });
    expect(JSON.stringify(requestPayload(workspace, "t_1", request, { answerFromNotification: true, private: false }))).not.toMatch(/Secret|example\.com|url/);
  });
});

describe("dispatch", () => {
  it("sends the payload built at send time, with the request id as topic, and marks it sent", async () => {
    const push = fakePushService();
    const device = await deviceFor(testDb.db, dana, { answerFromNotification: true });
    const { taskId, requestId } = await ask();
    await expect(sendDuePushes(testDb.db, push.deps)).resolves.toEqual({ sent: 1, failed: 0, dropped: 0 });
    expect(push.sent).toEqual([
      expect.objectContaining({
        topic: requestId,
        body: expect.objectContaining({ type: "request", requestId, taskId, question: "Which auditor?", options: ["Okafor", "Lindqvist"], answerable: true }),
      }),
    ]);
    expect(push.sent[0]!.keys.p256dh).toHaveLength(87);
    expect(await deliveriesOf(testDb.db, device.id)).toEqual([expect.objectContaining({ status: "sent", attempts: 1 })]);
    expect((await listDevices(personContext(testDb.db, dana)))[0]!.lastSuccessAt).toBeInstanceOf(Date);
    // Nothing left to send.
    await expect(sendDuePushes(testDb.db, push.deps)).resolves.toEqual({ sent: 0, failed: 0, dropped: 0 });
  });

  it("deletes a device the push service says is gone", async () => {
    for (const status of [404, 410]) {
      const push = fakePushService(() => status);
      const device = await deviceFor(testDb.db, dana);
      await ask();
      await sendDuePushes(testDb.db, push.deps);
      expect(await testDb.db.select().from(pushDevices).where(eq(pushDevices.id, device.id))).toEqual([]);
    }
  });

  it("backs off after a failure and gives up after a day", async () => {
    const push = fakePushService(() => 503);
    const device = await deviceFor(testDb.db, dana);
    await ask();
    await expect(sendDuePushes(testDb.db, push.deps)).resolves.toMatchObject({ failed: 1 });
    const [row] = await deliveriesOf(testDb.db, device.id);
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "HTTP 503" });
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    // Not due yet: nothing is sent.
    await expect(sendDuePushes(testDb.db, push.deps)).resolves.toMatchObject({ failed: 0 });

    await testDb.db.update(pushDeliveries).set({ createdAt: new Date(Date.now() - PUSH_GIVE_UP_MS - 1000), nextAttemptAt: new Date() }).where(eq(pushDeliveries.id, row!.id));
    await sendDuePushes(testDb.db, push.deps);
    expect(await deliveriesOf(testDb.db, device.id)).toEqual([expect.objectContaining({ status: "dead", lastError: "expired" })]);
    expect(push.sent).toHaveLength(1);
  });

  it("sends nothing without VAPID keys, and drops a push whose request closed before it went out", async () => {
    const device = await deviceFor(testDb.db, dana);
    const { taskId } = await ask();
    await expect(sendDuePushes(testDb.db, { send: null, budgetMs: 1000 })).resolves.toEqual({ sent: 0, failed: 0, dropped: 0 });
    expect(await deliveriesOf(testDb.db, device.id)).toEqual([expect.objectContaining({ status: "pending" })]);

    await answerInput(samCtx, { taskId, answer: "Okafor" });
    const push = fakePushService();
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent).toEqual([]);
    expect(await deliveriesOf(testDb.db, device.id)).toEqual([expect.objectContaining({ status: "dead", lastError: "closed" })]);
  });

  it("sends a private device the minimal payload", async () => {
    const push = fakePushService();
    await deviceFor(testDb.db, dana, { private: true, answerFromNotification: true });
    const { requestId, taskId } = await ask();
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.map((message) => message.body)).toEqual([{ v: 1, type: "request", private: true, slug: ws.tenant.slug, workspaceName: "Acme", requestId, taskId }]);
  });
});
