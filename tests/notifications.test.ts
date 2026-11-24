import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { events, pushDeliveries, pushDevices, tasks } from "@/server/db/schema";
import { personContext, type Ctx } from "@/server/domain/context";
import {
  answerFromNotification,
  forgetDevice,
  listDevices,
  muteWorkspace,
  notificationPreferencesOf,
  openDecisions,
  PUSH_MAX_DEVICES,
  PUSH_REGISTRATIONS_PER_MINUTE,
  registerDevice,
  setDeviceOptions,
  setNotificationPreferences,
  undoFromNotification,
  unmuteWorkspace,
} from "@/server/domain/notifications";
import { answerInput, captureTasks, collectAnswers, completeTask, requestInput, resolveInput, retractAnswer } from "@/server/domain/tasks";
import { PUSH_GIVE_UP_MS, PUSH_MAX_FAILURES, sendDuePushes } from "@/server/push/dispatch";
import { isPushServiceHost } from "@/server/push/endpoints";
import { inboxFeed } from "@/server/push/http";
import { PUSH_OPTION_CHARS, PUSH_PAYLOAD_MAX_BYTES, requestPayload } from "@/server/push/payload";
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
    const danaCtx = personContext(testDb.db, dana);
    const registered = await registerDevice(danaCtx, { ...shared, label: "Chrome on Android" }, { resolve: publicResolver });
    const before = await setDeviceOptions(danaCtx, { deviceId: registered.id, answerFromNotification: true, private: true });
    await ask();
    // Dana's device has a request queued (Scout asked; Dana did not).
    expect(await deliveriesOf(testDb.db, before.id)).toHaveLength(1);

    const after = await registerDevice(personContext(testDb.db, sam), { ...shared, label: "Shared laptop" }, { resolve: publicResolver });
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({ answerFromNotification: false, private: false, label: "Shared laptop" });
    expect(await listDevices(personContext(testDb.db, dana))).toEqual([]);
    expect(await deliveriesOf(testDb.db, before.id)).toEqual([]);
  });

  it("refuses to move a device to someone posting its endpoint without its keys", async () => {
    const theirs = await deviceFor(testDb.db, dana);
    // Sam learned the endpoint (a log, a shoulder) but not the browser's keys.
    await expect(registerDevice(personContext(testDb.db, sam), { ...subscription(theirs.endpoint), label: "Mine now" }, { resolve: publicResolver })).rejects.toMatchObject({ code: "forbidden" });
    const [row] = await testDb.db.select().from(pushDevices).where(eq(pushDevices.id, theirs.id));
    expect(row).toMatchObject({ userId: dana.id, label: "Chrome on Android" });
    // The same person subscribing again with new keys (the browser renewed it) is fine.
    await expect(registerDevice(personContext(testDb.db, dana), { ...subscription(theirs.endpoint), label: "Renewed" }, { resolve: publicResolver })).resolves.toMatchObject({ id: theirs.id, label: "Renewed" });
  });

  it(`keeps at most ${PUSH_MAX_DEVICES} devices a person, dropping the one turned on longest ago`, async () => {
    const ids: string[] = [];
    for (let index = 0; index < PUSH_MAX_DEVICES + 1; index++) {
      ids.push((await deviceFor(testDb.db, dana, { label: `Browser ${index}` })).id);
      // Spread over time, so the rate limit does not apply and the order is clear.
      await testDb.db.update(pushDevices).set({ registeredAt: new Date(Date.now() - (PUSH_MAX_DEVICES + 1 - index) * 120_000) }).where(eq(pushDevices.id, ids.at(-1)!));
    }
    const left = (await listDevices(personContext(testDb.db, dana))).map((device) => device.id).sort();
    expect(left).toHaveLength(PUSH_MAX_DEVICES);
    expect(left).toEqual(ids.slice(1).sort());
  });

  it(`turns on at most ${PUSH_REGISTRATIONS_PER_MINUTE} different devices a minute, while one subscribing again always may`, async () => {
    const devices = [];
    for (let index = 0; index < PUSH_REGISTRATIONS_PER_MINUTE; index++) devices.push(await deviceFor(testDb.db, dana));
    await expect(deviceFor(testDb.db, dana)).rejects.toMatchObject({ code: "invalid" });
    const again = subscription(devices[0]!.endpoint);
    await expect(registerDevice(personContext(testDb.db, dana), { ...again, label: "Again" }, { resolve: publicResolver })).resolves.toMatchObject({ id: devices[0]!.id });
    // Someone else's limit is their own.
    await expect(deviceFor(testDb.db, sam)).resolves.toMatchObject({ label: "Chrome on Android" });
    await testDb.db.update(pushDevices).set({ registeredAt: new Date(Date.now() - 61_000) }).where(eq(pushDevices.userId, dana.id));
    await expect(deviceFor(testDb.db, dana)).resolves.toMatchObject({ label: "Chrome on Android" });
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

  it("replaces the notification on everyone else's devices once a person answers on the web, never their own, and drops it where it was never sent", async () => {
    const push = fakePushService();
    const danaDevice = await deviceFor(testDb.db, dana);
    const samDevice = await deviceFor(testDb.db, sam);
    const { taskId, requestId } = await ask();
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.map((message) => message.body.type)).toEqual(["request", "request"]);

    await answerInput(ws.human, { taskId, answer: "Okafor" });
    // Dana answered on the web: she is not told what she did; Sam is told by whom.
    expect((await deliveriesOf(testDb.db, danaDevice.id)).map((row) => row.kind)).toEqual(["request"]);
    expect((await deliveriesOf(testDb.db, samDevice.id)).map((row) => row.kind)).toEqual(["request", "resolved"]);
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.at(-1)).toMatchObject({ endpoint: samDevice.endpoint, topic: requestId, body: { v: 1, type: "resolved", slug: ws.tenant.slug, requestId, reason: "answered", by: "Dana" } });

    // Dana takes the answer back: the request is open again for Sam, while Dana's row is written already dead.
    await retractAnswer(ws.human, { taskId, requestId });
    expect((await deliveriesOf(testDb.db, samDevice.id)).map((row) => row.kind)).toEqual(["request", "resolved", "request"]);
    expect((await deliveriesOf(testDb.db, danaDevice.id)).map((row) => [row.kind, row.status, row.lastError])).toEqual([
      ["request", "sent", null],
      ["request", "dead", "own_action"],
    ]);
    // Sam answers before that push went out: it is dropped, with nothing to replace, and Sam hears nothing of his own answer.
    await answerInput(samCtx, { taskId, answer: "Lindqvist" });
    const rows = await deliveriesOf(testDb.db, samDevice.id);
    expect(rows.map((row) => [row.kind, row.status])).toEqual([
      ["request", "sent"],
      ["resolved", "sent"],
      ["request", "dead"],
    ]);
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.filter((message) => message.endpoint === danaDevice.endpoint).map((message) => message.body.type)).toEqual(["request"]);
  });

  it("replaces the notification on other people's devices when a person answers from a notification, and on none of theirs", async () => {
    const push = fakePushService();
    const phone = await deviceFor(testDb.db, dana, { answerFromNotification: true });
    const laptop = await deviceFor(testDb.db, dana, { label: "Firefox on Linux" });
    const samDevice = await deviceFor(testDb.db, sam);
    const { taskId, requestId } = await ask();
    await sendDuePushes(testDb.db, push.deps);

    await answerFromNotification(ws.human, { taskId, requestId, option: 0, endpoint: phone.endpoint });
    // The phone shows "Sent", with Undo; Dana's laptop is not told what she did; Sam's device has its notification replaced.
    for (const device of [phone, laptop]) expect((await deliveriesOf(testDb.db, device.id)).map((row) => [row.kind, row.status])).toEqual([["request", "sent"]]);
    expect((await deliveriesOf(testDb.db, samDevice.id)).map((row) => [row.kind, row.status])).toEqual([["request", "sent"], ["resolved", "pending"]]);

    // Undo from the phone: the request is open again for Sam; the phone shows it itself and counts it as shown; the laptop hears nothing.
    await undoFromNotification(ws.human, { taskId, requestId, endpoint: phone.endpoint });
    expect((await deliveriesOf(testDb.db, phone.id)).at(-1)).toMatchObject({ kind: "request", status: "sent" });
    expect((await deliveriesOf(testDb.db, laptop.id)).at(-1)).toMatchObject({ kind: "request", status: "dead", lastError: "own_action" });
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.filter((message) => message.endpoint === phone.endpoint).map((message) => message.body.type)).toEqual(["request"]);
    expect(push.sent.filter((message) => message.endpoint === laptop.endpoint).map((message) => message.body.type)).toEqual(["request"]);
    expect(push.sent.filter((message) => message.endpoint === samDevice.endpoint).map((message) => message.body.type)).toEqual(["request", "resolved", "request"]);

    // Someone else answers now: the phone's notification (the request again) is replaced; the laptop, never sent it again, is not.
    await answerInput(samCtx, { taskId, answer: "Lindqvist" });
    expect((await deliveriesOf(testDb.db, phone.id)).at(-1)).toMatchObject({ kind: "resolved", status: "pending" });
    expect((await deliveriesOf(testDb.db, laptop.id)).at(-1)).toMatchObject({ kind: "request", status: "dead" });

    // Another person's endpoint names nothing of Dana's: her answer still clears only other people's devices.
    const second = await ask("Which bank?");
    await sendDuePushes(testDb.db, push.deps);
    await answerFromNotification(ws.human, { ...second, option: 0, endpoint: samDevice.endpoint });
    expect((await deliveriesOf(testDb.db, samDevice.id)).at(-1)).toMatchObject({ kind: "resolved", requestId: second.requestId, status: "pending" });
    for (const device of [phone, laptop]) expect((await deliveriesOf(testDb.db, device.id)).at(-1)).toMatchObject({ kind: "request", requestId: second.requestId });
  });

  it("checks again at send time that no one is sent what they did themselves", async () => {
    const push = fakePushService();
    const danaDevice = await deviceFor(testDb.db, dana);
    const { taskId, requestId } = await ask();
    await sendDuePushes(testDb.db, push.deps);
    await answerInput(ws.human, { taskId, answer: "Okafor" });
    // A resolved push for Dana queued all the same (by an older server, say) is dropped when it would go out.
    const [answered] = await testDb.db.select({ id: events.id }).from(events).where(eq(events.action, "task.input_answered"));
    await testDb.db.insert(pushDeliveries).values({ tenantId: ws.tenant.id, deviceId: danaDevice.id, eventId: answered!.id, kind: "resolved", taskId, requestId });
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.map((message) => message.body.type)).toEqual(["request"]);
    expect((await deliveriesOf(testDb.db, danaDevice.id)).at(-1)).toMatchObject({ kind: "resolved", status: "dead", lastError: "own_action" });
  });

  it("pushes an agent's new question on the same task, and says the old one was replaced, not answered", async () => {
    const push = fakePushService();
    const device = await deviceFor(testDb.db, dana);
    const first = await ask();
    await sendDuePushes(testDb.db, push.deps);
    const again = await requestInput(ws.scout.ctx, { taskId: first.taskId, kind: "decision", question: "Okafor or Brandt?", options: ["Okafor", "Brandt"] });
    const newer = again.inputRequest!.id;
    expect((await deliveriesOf(testDb.db, device.id)).map((row) => [row.kind, row.requestId])).toEqual([
      ["request", first.requestId],
      ["resolved", first.requestId],
      ["request", newer],
    ]);
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.map((message) => message.body)).toEqual([
      expect.objectContaining({ type: "request", requestId: first.requestId }),
      { v: 1, type: "resolved", slug: ws.tenant.slug, requestId: first.requestId, reason: "replaced" },
      expect.objectContaining({ type: "request", requestId: newer, question: "Okafor or Brandt?" }),
    ]);
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

    // Closed by the agent, never "answered" by it: `by` is only ever a person who answered.
    expect(push.sent.map((message) => [message.body.type, message.body.requestId, message.body.reason ?? null, message.body.by ?? null, message.body.closedBy ?? null])).toEqual([
      ["request", first.requestId, null, null, null],
      ["resolved", first.requestId, "closed", null, "Scout"],
      ["request", second.requestId, null, null, null],
      ["resolved", second.requestId, "closed", null, "Scout"],
    ]);
    // Each request is resolved once, however many changes follow.
    await captureTasks(ws.scout.ctx, { tasks: [{ title: "Unrelated" }] });
    expect((await deliveriesOf(testDb.db, device.id)).filter((row) => row.kind === "resolved")).toHaveLength(2);
  });

  it("names no one to a private device when a request closes", async () => {
    const push = fakePushService();
    await deviceFor(testDb.db, sam, { private: true });
    const first = await ask();
    await sendDuePushes(testDb.db, push.deps);
    await answerInput(ws.human, { taskId: first.taskId, answer: "Okafor" });
    const second = await ask("Which bank?");
    await sendDuePushes(testDb.db, push.deps);
    await resolveInput(ws.scout.ctx, { taskId: second.taskId });
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent.filter((message) => message.body.type === "resolved").map((message) => message.body)).toEqual([
      { v: 1, type: "resolved", slug: ws.tenant.slug, requestId: first.requestId, reason: "answered" },
      { v: 1, type: "resolved", slug: ws.tenant.slug, requestId: second.requestId, reason: "closed" },
    ]);
  });
});

describe("preferences", () => {
  it("starts with everything on, changes only what is posted, and refuses a change that changes nothing", async () => {
    const ctx = personContext(testDb.db, dana);
    expect(await notificationPreferencesOf(ctx)).toEqual({ requests: true, reopened: true, resolved: true });
    expect(await setNotificationPreferences(ctx, { resolved: "false" })).toEqual({ requests: true, reopened: true, resolved: false });
    expect(await setNotificationPreferences(ctx, { requests: false })).toEqual({ requests: false, reopened: true, resolved: false });
    await expect(setNotificationPreferences(ctx, { requests: false, resolved: false })).rejects.toMatchObject({ code: "invalid" });
    await expect(setNotificationPreferences(ctx, {})).rejects.toMatchObject({ code: "invalid" });
    // A person's choices are theirs alone.
    expect(await notificationPreferencesOf(personContext(testDb.db, sam))).toEqual({ requests: true, reopened: true, resolved: true });
  });

  it("queues no new request for someone who turned requests off, and still tells them an answer was taken back", async () => {
    const samDevice = await deviceFor(testDb.db, sam);
    await setNotificationPreferences(personContext(testDb.db, sam), { requests: false });
    const { taskId, requestId } = await ask();
    expect(await deliveriesOf(testDb.db, samDevice.id)).toEqual([]);
    await answerInput(ws.human, { taskId, answer: "Okafor" });
    await retractAnswer(ws.human, { taskId, requestId });
    expect((await deliveriesOf(testDb.db, samDevice.id)).map((row) => [row.kind, row.status])).toEqual([["request", "pending"]]);

    await setNotificationPreferences(personContext(testDb.db, sam), { reopened: false });
    await answerInput(ws.human, { taskId, answer: "Okafor" });
    await retractAnswer(ws.human, { taskId, requestId });
    expect((await deliveriesOf(testDb.db, samDevice.id)).filter((row) => row.status === "pending")).toEqual([]);
  });

  it("leaves a notification in place for someone who turned resolved updates off", async () => {
    const push = fakePushService();
    const samDevice = await deviceFor(testDb.db, sam);
    const { taskId } = await ask();
    await sendDuePushes(testDb.db, push.deps);
    await setNotificationPreferences(personContext(testDb.db, sam), { resolved: false });
    await answerInput(ws.human, { taskId, answer: "Okafor" });
    expect((await deliveriesOf(testDb.db, samDevice.id)).map((row) => row.kind)).toEqual(["request"]);
  });

  it("drops at send time what the person turned off after it was queued", async () => {
    const push = fakePushService();
    const samDevice = await deviceFor(testDb.db, sam);
    await ask();
    await setNotificationPreferences(personContext(testDb.db, sam), { requests: false });
    await sendDuePushes(testDb.db, push.deps);
    expect(push.sent).toEqual([]);
    expect(await deliveriesOf(testDb.db, samDevice.id)).toEqual([expect.objectContaining({ status: "dead", lastError: "preference" })]);
  });

  it("tells the desktop feed not to announce requests when they are turned off, and still lists them", async () => {
    const { requestId } = await ask();
    expect((await inboxFeed(testDb.db, sam)).items).toEqual([expect.objectContaining({ requestId, notify: true })]);
    await setNotificationPreferences(personContext(testDb.db, sam), { requests: false });
    const feed = await inboxFeed(testDb.db, sam);
    expect(feed).toMatchObject({ pending: 1, items: [expect.objectContaining({ requestId, notify: false })] });
    expect((await inboxFeed(testDb.db, dana)).items).toEqual([expect.objectContaining({ notify: true })]);
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

  it("never applies ticked positions, posted for one request, to a newer one's options", async () => {
    // What the Decisions page's multiple-choice form posts: the positions, with the request it showed.
    const shown = await ask("Which channels?", ["Slack", "Email", "Blog"], { multiple: true });
    await requestInput(ws.scout.ctx, { taskId: shown.taskId, kind: "decision", question: "Which regions?", options: ["EU", "US", "APAC"], multiple: true });
    await expect(answerInput(ws.human, { taskId: shown.taskId, requestId: shown.requestId, choices: ["0", "2"] } as never)).rejects.toMatchObject({ code: "conflict" });
    await expect(answerInput(ws.human, { taskId: shown.taskId, requestId: shown.requestId, answer: "Slack" })).rejects.toMatchObject({ code: "conflict" });
    expect(await collectAnswers(ws.scout.ctx, {})).toEqual([]);
  });

  it("lets only the person who answered take the answer back", async () => {
    const { taskId, requestId } = await ask();
    await answerInput(samCtx, { taskId, answer: "Okafor", requestId });
    await expect(retractAnswer(ws.human, { taskId, requestId })).rejects.toMatchObject({ code: "forbidden" });
    await expect(undoFromNotification(ws.human, { taskId, requestId })).rejects.toMatchObject({ code: "forbidden" });
    await expect(retractAnswer(samCtx, { taskId, requestId })).resolves.toMatchObject({ inputRequest: { id: requestId } });
  });

  it("lets anyone in the workspace take back an answer recorded before Phean kept who gave it", async () => {
    const { taskId, requestId } = await ask();
    const answered = await answerInput(samCtx, { taskId, answer: "Okafor", requestId });
    // An answer from before: no `answeredByUserId` on the record.
    const legacy = answered.inputAnswers.map((entry) => {
      const copy = { ...entry };
      delete copy.answeredByUserId;
      return copy;
    });
    await testDb.db.update(tasks).set({ inputAnswers: legacy }).where(eq(tasks.id, taskId));
    await expect(retractAnswer(ws.human, { taskId, requestId })).resolves.toMatchObject({ inputRequest: { id: requestId } });
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
    const heaviest = ["\u0001".repeat(PUSH_OPTION_CHARS), "🪨".repeat(PUSH_OPTION_CHARS / 2)];
    const long = { ...request, question: "\u0001🪨".repeat(1000), options: heaviest, agentName: "x".repeat(80), viaAgentName: "🪨".repeat(80) };
    const payload = requestPayload({ slug: "a".repeat(40), name: "🪨".repeat(80) }, "t_1", long, { answerFromNotification: true, private: false });
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    expect(bytes).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
    // The question is cut to fit; the buttons never are.
    expect(payload).toMatchObject({ type: "request", answerable: true, options: heaviest });
    expect(JSON.stringify(requestPayload(workspace, "t_1", request, { answerFromNotification: true, private: false }))).not.toMatch(/Secret|example\.com|url/);
  });

  it("sends no buttons when an option is longer than a button shows, rather than a cut label", () => {
    const wordy = { ...request, options: ["Okafor", `Lindqvist, but only if ${"they agree to the fixed fee and the March start ".repeat(2)}`] };
    expect(wordy.options[1]!.length).toBeGreaterThan(PUSH_OPTION_CHARS);
    expect(requestPayload(workspace, "t_1", wordy, { answerFromNotification: true, private: false })).toMatchObject({ options: [], answerable: false, question: "Which auditor?" });
    // An option past the two buttons changes nothing.
    expect(requestPayload(workspace, "t_1", { ...request, options: ["Okafor", "Lindqvist", "x".repeat(200)] }, { answerFromNotification: true, private: false })).toMatchObject({ options: ["Okafor", "Lindqvist"], answerable: true });
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

  it("backs off after a failure, and gives up once the next try would be more than a day after the push", async () => {
    const push = fakePushService(() => 503);
    const device = await deviceFor(testDb.db, dana);
    await ask();
    await expect(sendDuePushes(testDb.db, push.deps)).resolves.toMatchObject({ failed: 1 });
    const [row] = await deliveriesOf(testDb.db, device.id);
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "HTTP 503" });
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    // Not due yet: nothing is sent.
    await expect(sendDuePushes(testDb.db, push.deps)).resolves.toMatchObject({ failed: 0 });

    // Due again, 23 hours in, after five tries: the next would wait six hours, past the day, so this try is the last.
    await testDb.db
      .update(pushDeliveries)
      .set({ createdAt: new Date(Date.now() - PUSH_GIVE_UP_MS + 60 * 60 * 1000), nextAttemptAt: new Date(), attempts: 5 })
      .where(eq(pushDeliveries.id, row!.id));
    await expect(sendDuePushes(testDb.db, push.deps)).resolves.toMatchObject({ failed: 1 });
    expect(await deliveriesOf(testDb.db, device.id)).toEqual([expect.objectContaining({ status: "dead", attempts: 6, lastError: "HTTP 503" })]);
    expect(push.sent).toHaveLength(2);
  });

  it("expires a push still queued a day on, without trying it", async () => {
    const push = fakePushService(() => 503);
    const device = await deviceFor(testDb.db, dana);
    await ask();
    await testDb.db.update(pushDeliveries).set({ createdAt: new Date(Date.now() - PUSH_GIVE_UP_MS - 1000) }).where(eq(pushDeliveries.deviceId, device.id));
    await expect(sendDuePushes(testDb.db, push.deps)).resolves.toEqual({ sent: 0, failed: 0, dropped: 0 });
    expect(await deliveriesOf(testDb.db, device.id)).toEqual([expect.objectContaining({ status: "dead", lastError: "expired", attempts: 0 })]);
    expect(push.sent).toEqual([]);
  });

  it("deletes a device the push service refuses this server for, and keeps one it asks to wait", async () => {
    for (const status of [401, 403]) {
      const device = await deviceFor(testDb.db, dana);
      await ask();
      await sendDuePushes(testDb.db, fakePushService(() => status).deps);
      expect(await testDb.db.select().from(pushDevices).where(eq(pushDevices.id, device.id)), String(status)).toEqual([]);
    }
    for (const status of [429, 500, 503]) {
      const device = await deviceFor(testDb.db, sam);
      await ask();
      await sendDuePushes(testDb.db, fakePushService(() => status).deps);
      expect(await deliveriesOf(testDb.db, device.id), String(status)).toEqual([expect.objectContaining({ status: "pending", attempts: 1 })]);
      await testDb.db.delete(pushDevices).where(eq(pushDevices.id, device.id));
    }
  });

  it(`deletes a device after ${PUSH_MAX_FAILURES} failed sends in a row`, async () => {
    const push = fakePushService(() => 503);
    const device = await deviceFor(testDb.db, dana);
    await testDb.db.update(pushDevices).set({ failures: PUSH_MAX_FAILURES - 2 }).where(eq(pushDevices.id, device.id));
    await ask();
    await sendDuePushes(testDb.db, push.deps);
    expect(await testDb.db.select({ failures: pushDevices.failures }).from(pushDevices).where(eq(pushDevices.id, device.id))).toEqual([{ failures: PUSH_MAX_FAILURES - 1 }]);
    await ask("Which bank?");
    await sendDuePushes(testDb.db, push.deps);
    expect(await testDb.db.select().from(pushDevices).where(eq(pushDevices.id, device.id))).toEqual([]);
  });

  it("never sends a row twice when a slow send lets another sender take over the rows after it", async () => {
    const device = await deviceFor(testDb.db, dana);
    await ask("Which auditor?");
    await ask("Which bank?");
    const [first, second] = await deliveriesOf(testDb.db, device.id);
    const other = fakePushService();
    let slow = true;
    // The first send takes longer than the lease: by its end the second row's lease has run out, and another sweep takes it.
    const push = fakePushService(() => 201);
    const slowSend: typeof push.send = async (message) => {
      if (slow) {
        slow = false;
        await testDb.db.update(pushDeliveries).set({ leaseUntil: new Date(Date.now() - 1000) }).where(eq(pushDeliveries.id, second!.id));
        await expect(sendDuePushes(testDb.db, other.deps)).resolves.toEqual({ sent: 1, failed: 0, dropped: 0 });
      }
      return push.send(message);
    };
    await expect(sendDuePushes(testDb.db, { send: slowSend, budgetMs: 5_000 })).resolves.toEqual({ sent: 1, failed: 0, dropped: 0 });
    expect(push.sent.map((message) => message.body.question)).toEqual(["Which auditor?"]);
    expect(other.sent.map((message) => message.body.question)).toEqual(["Which bank?"]);
    expect((await deliveriesOf(testDb.db, device.id)).map((row) => [row.id, row.status, row.attempts])).toEqual([
      [first!.id, "sent", 1],
      [second!.id, "sent", 1],
    ]);
  });

  it("leaves a row's outcome to the sender that took it over", async () => {
    const device = await deviceFor(testDb.db, dana);
    await ask();
    const [row] = await deliveriesOf(testDb.db, device.id);
    const push = fakePushService();
    const send: typeof push.send = async (message) => {
      // Another sender took this row over (its lease ran out mid-send) and holds it now.
      await testDb.db.update(pushDeliveries).set({ leaseToken: "another-sender", leaseUntil: new Date(Date.now() + 60_000) }).where(eq(pushDeliveries.id, row!.id));
      return push.send(message);
    };
    await sendDuePushes(testDb.db, { send, budgetMs: 1_000 });
    expect(await deliveriesOf(testDb.db, device.id)).toEqual([expect.objectContaining({ status: "pending", attempts: 0, leaseToken: "another-sender" })]);
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
