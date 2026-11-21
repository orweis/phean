import { generateVAPIDKeys } from "web-push";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Ctx } from "@/server/domain/context";
import { muteWorkspace } from "@/server/domain/notifications";
import { captureTasks, collectAnswers, requestInput } from "@/server/domain/tasks";
import { webPushSender } from "@/server/push/dispatch";
import { CLIENT_HEADER, handleInbox, handlePushAnswer, handlePushUndo, MIN_SHELL_VERSION } from "@/server/push/http";

import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";
import { publicResolver, subscription } from "./support/push";

const ORIGIN = "https://phean.test";
const origins = [ORIGIN];

let testDb: TestDb;
let ws: Workspace;

beforeEach(async () => {
  testDb = await createTestDb();
  ws = await seedWorkspace(testDb.db);
});
afterEach(() => testDb.close());

async function ask(question = "Which auditor?") {
  const { created } = await captureTasks(ws.scout.ctx, { tasks: [{ title: "Pick the auditor" }] });
  const task = await requestInput(ws.scout.ctx, { taskId: created[0]!.id, kind: "decision", question, options: ["Okafor", "Lindqvist"] });
  return { taskId: task.id, requestId: task.inputRequest!.id };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/w/acme/push/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", [CLIENT_HEADER]: "web", origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const as = (ctx: Ctx | null) => async () => ctx;

describe("POST /w/<slug>/push/answer", () => {
  it("answers by option index with the request's own label, without caching", async () => {
    const { taskId, requestId } = await ask();
    // A label sent with the index is never read.
    const response = await handlePushAnswer(post({ taskId, requestId, option: 0, label: "Brandt" }), as(ws.human), { origins });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ answer: "Okafor", taskTitle: "Pick the auditor", agentName: "Scout" });
  });

  it("refuses a request without the client header, a JSON body or Phean's own origin, before reading the session", async () => {
    const { taskId, requestId } = await ask();
    let resolved = 0;
    const counting = async () => {
      resolved += 1;
      return ws.human;
    };
    const body = { taskId, requestId, option: 0 };
    expect((await handlePushAnswer(post(body, { [CLIENT_HEADER]: "" }), counting, { origins })).status).toBe(400);
    expect((await handlePushAnswer(post(body, { [CLIENT_HEADER]: "evil" }), counting, { origins })).status).toBe(400);
    expect((await handlePushAnswer(post(body, { origin: "https://evil.example" }), counting, { origins })).status).toBe(403);
    expect((await handlePushAnswer(post(body, { origin: "null" }), counting, { origins })).status).toBe(403);
    expect((await handlePushAnswer(post(new URLSearchParams(body as never).toString(), { "content-type": "application/x-www-form-urlencoded" }), counting, { origins })).status).toBe(415);
    expect((await handlePushAnswer(post(body, { "content-type": "text/plain" }), counting, { origins })).status).toBe(415);
    expect(resolved).toBe(0);

    // The desktop sends no Origin at all, which is allowed.
    const desktop = new Request(`${ORIGIN}/w/acme/push/answer`, { method: "POST", headers: { "content-type": "application/json", [CLIENT_HEADER]: "desktop" }, body: JSON.stringify(body) });
    expect((await handlePushAnswer(desktop, counting, { origins })).status).toBe(200);
  });

  it("allows Sec-Fetch-Site same-origin (the page) and none (the desktop's main process), and refuses same-site and cross-site", async () => {
    const body = { answer: "Okafor" };
    for (const site of ["cross-site", "same-site"]) {
      const { taskId, requestId } = await ask();
      expect((await handlePushAnswer(post({ taskId, requestId, ...body }, { "sec-fetch-site": site }), as(ws.human), { origins })).status, site).toBe(403);
      const undo = new Request(`${ORIGIN}/w/acme/push/undo`, { method: "POST", headers: { "content-type": "application/json", [CLIENT_HEADER]: "web", "sec-fetch-site": site }, body: JSON.stringify({ taskId, requestId }) });
      expect((await handlePushUndo(undo, as(ws.human), { origins })).status, site).toBe(403);
    }
    for (const site of ["same-origin", "none"]) {
      const { taskId, requestId } = await ask();
      // The page sends its Origin with same-origin; the desktop sends none and no Origin.
      const request =
        site === "none"
          ? new Request(`${ORIGIN}/w/acme/push/answer`, { method: "POST", headers: { "content-type": "application/json", [CLIENT_HEADER]: "desktop", "sec-fetch-site": site }, body: JSON.stringify({ taskId, requestId, ...body }) })
          : post({ taskId, requestId, ...body }, { "sec-fetch-site": site });
      expect((await handlePushAnswer(request, as(ws.human), { origins })).status, site).toBe(200);
      const undo = new Request(`${ORIGIN}/w/acme/push/undo`, { method: "POST", headers: { "content-type": "application/json", [CLIENT_HEADER]: "desktop", "sec-fetch-site": site }, body: JSON.stringify({ taskId, requestId }) });
      expect((await handlePushUndo(undo, as(ws.human), { origins })).status, site).toBe(200);
    }
  });

  it("answers 401 without a session, 409 stale for an answered request, and 400 for a malformed body", async () => {
    const { taskId, requestId } = await ask();
    expect((await handlePushAnswer(post({ taskId, requestId, option: 0 }), as(null), { origins })).status).toBe(401);
    expect((await handlePushAnswer(post("{not json"), as(ws.human), { origins })).status).toBe(400);
    expect((await handlePushAnswer(post({ taskId, requestId, option: "0" }), as(ws.human), { origins })).status).toBe(400);
    expect((await handlePushAnswer(post({ taskId, requestId, option: 1 }), as(ws.human), { origins })).status).toBe(200);
    const stale = await handlePushAnswer(post({ taskId, requestId, option: 0 }), as(ws.human), { origins });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "stale" });
  });

  it("takes the answer back with Undo until the agent collected it", async () => {
    const { taskId, requestId } = await ask();
    await handlePushAnswer(post({ taskId, requestId, option: 0 }), as(ws.human), { origins });
    const undo = (headers: Record<string, string> = {}) =>
      handlePushUndo(new Request(`${ORIGIN}/w/acme/push/undo`, { method: "POST", headers: { "content-type": "application/json", [CLIENT_HEADER]: "web", ...headers }, body: JSON.stringify({ taskId, requestId }) }), as(ws.human), { origins });
    expect((await undo({ origin: "https://evil.example" })).status).toBe(403);
    const taken = await undo();
    expect(taken.status).toBe(200);
    expect(await taken.json()).toEqual({});

    await handlePushAnswer(post({ taskId, requestId, option: 1 }), as(ws.human), { origins });
    await collectAnswers(ws.scout.ctx, {});
    expect((await undo()).status).toBe(409);
  });
});

describe("GET /api/native/inbox", () => {
  const get = (headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/native/inbox`, { headers: { [CLIENT_HEADER]: "desktop", ...headers } });
  const person = () => ({ id: ws.human.actor.id, name: ws.human.actor.name });

  it("lists the person's open requests with an ETag, and answers 304 while nothing changed", async () => {
    const { requestId } = await ask();
    const response = await handleInbox(get(), { db: testDb.db, person: person(), origins });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const etag = response.headers.get("etag")!;
    expect(await response.json()).toEqual({
      pending: 1,
      minShellVersion: MIN_SHELL_VERSION,
      items: [expect.objectContaining({ requestId, slug: ws.tenant.slug, workspaceName: "Acme", agentName: "Scout", question: "Which auditor?", options: ["Okafor", "Lindqvist"], multiple: false })],
    });
    expect((await handleInbox(get({ "if-none-match": etag }), { db: testDb.db, person: person(), origins })).status).toBe(304);
    await ask("Which bank?");
    expect((await handleInbox(get({ "if-none-match": etag }), { db: testDb.db, person: person(), origins })).status).toBe(200);
  });

  it("counts a muted workspace without listing it, and needs the header and a session", async () => {
    await ask();
    await muteWorkspace(ws.human, {});
    const muted = await handleInbox(get(), { db: testDb.db, person: person(), origins });
    expect(await muted.json()).toMatchObject({ pending: 1, items: [] });
    expect((await handleInbox(get({ [CLIENT_HEADER]: "" }), { db: testDb.db, person: person(), origins })).status).toBe(400);
    expect((await handleInbox(get({ origin: "https://evil.example" }), { db: testDb.db, person: person(), origins })).status).toBe(403);
    expect((await handleInbox(get(), { db: testDb.db, person: null, origins })).status).toBe(401);
    for (const site of ["cross-site", "same-site"]) expect((await handleInbox(get({ "sec-fetch-site": site }), { db: testDb.db, person: person(), origins })).status, site).toBe(403);
    for (const site of ["same-origin", "none"]) expect((await handleInbox(get({ "sec-fetch-site": site }), { db: testDb.db, person: person(), origins })).status, site).toBe(200);
  });
});

describe("the web-push sender", () => {
  const vapid = { ...generateVAPIDKeys(), subject: "mailto:ops@phean.test" };

  it("posts an encrypted, VAPID-signed push with a day's TTL, high urgency and the topic, and follows no redirect", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeService = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status: 201 });
    };
    const send = webPushSender(vapid, { fetch: fakeService as typeof fetch, resolve: publicResolver });
    const device = subscription();
    const payload = JSON.stringify({ v: 1, type: "request", question: "Which auditor?" });
    await expect(send({ endpoint: device.endpoint, keys: device.keys, payload, topic: "q_0123456789ab" })).resolves.toEqual({ status: 201, error: null });

    const [call] = calls;
    expect(call!.url).toBe(device.endpoint);
    expect(call!.init.redirect).toBe("manual");
    const headers = call!.init.headers as Record<string, string>;
    expect(headers).toMatchObject({ TTL: "86400", Urgency: "high", Topic: "q_0123456789ab", "Content-Encoding": "aes128gcm" });
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`));
    const body = Buffer.from(call!.init.body as Uint8Array);
    expect(body.length).toBeGreaterThan(payload.length);
    expect(body.toString("utf8")).not.toContain("auditor");
  });

  it("refuses an endpoint off the push services or on a private address before sending", async () => {
    let called = false;
    const fakeService = (async () => {
      called = true;
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const device = subscription();
    const privateDns = webPushSender(vapid, { fetch: fakeService, resolve: async () => ["169.254.169.254"] });
    await expect(privateDns({ endpoint: device.endpoint, keys: device.keys, payload: "{}", topic: "q_1" })).resolves.toMatchObject({ status: null });
    const elsewhere = webPushSender(vapid, { fetch: fakeService, resolve: publicResolver });
    await expect(elsewhere({ endpoint: "https://evil.example/push", keys: device.keys, payload: "{}", topic: "q_1" })).resolves.toMatchObject({ status: null });
    expect(called).toBe(false);
  });
});
