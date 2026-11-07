import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { eq, sql } from "drizzle-orm";

import { agents, realtimeStreams } from "@/server/db/schema";
import { createSubagent, revokeAgent } from "@/server/domain/agents";
import { answerInput, captureTasks, requestInput, updateTask } from "@/server/domain/tasks";
import { authenticateStream, streamRefusal, streamToken, STREAM_PROTOCOL, TOKEN_PROTOCOL_PREFIX } from "@/server/realtime/auth";
import { CLOSE, parseStreamOptions, runEventStream, STREAM_LIMITS, type StreamLimits, type StreamMessage } from "@/server/realtime/stream";

import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";

const FAST = { pollMs: 25, recheckMs: 40, heartbeatMs: 60_000 };

let testDb: TestDb;
let server: Server;
let base: string;
let limits: Partial<StreamLimits> = FAST;
const sockets: WebSocket[] = [];

/** The route's checks and the real stream, on a plain Node server, since only Vercel's runtime upgrades in a route handler. */
beforeAll(async () => {
  testDb = await createTestDb();
  const wss = new WebSocketServer({ noServer: true, maxPayload: STREAM_LIMITS.maxClientMessage });
  server = createServer();
  server.on("upgrade", async (req, socket, head) => {
    const headers = new Headers(Object.entries(req.headers).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])) as [string, string][]);
    const auth = await authenticateStream(testDb.db, headers);
    const options = parseStreamOptions(new URL(req.url!, "http://phean.test"));
    if ("error" in auth || "error" in options || streamRefusal(testDb.db, auth.principal, options.scope)) {
      socket.end(`HTTP/1.1 ${"error" in auth ? auth.status : 400} Refused\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => void runEventStream(ws, { db: testDb.db, principal: auth.principal, options, origin: "https://phean.test", limits }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/events`;
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.terminate();
  limits = FAST;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await testDb.close();
});

let ws: Workspace;
beforeEach(async () => {
  ws = await seedWorkspace(testDb.db);
});

interface Client {
  socket: WebSocket;
  next: (type: StreamMessage["type"]) => Promise<StreamMessage>;
  closed: Promise<{ code: number; reason: string }>;
}

function connect(token: string, query = "", init: { protocols?: string[]; headers?: Record<string, string> } = {}): Client {
  const headers = init.protocols ? init.headers : { Authorization: `Bearer ${token}`, ...init.headers };
  const socket = new WebSocket(`${base}${query}`, init.protocols ?? [], { headers });
  sockets.push(socket);
  socket.on("error", () => undefined); // a refused upgrade; the close code says why
  const inbox: StreamMessage[] = [];
  const waiters: { type: string; resolve: (message: StreamMessage) => void }[] = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as StreamMessage;
    const waiter = waiters.findIndex((entry) => entry.type === message.type);
    if (waiter >= 0) waiters.splice(waiter, 1)[0]!.resolve(message);
    else inbox.push(message);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => socket.on("close", (code, reason) => resolve({ code, reason: String(reason) })));
  const next = (type: StreamMessage["type"]) => {
    const queued = inbox.findIndex((message) => message.type === type);
    if (queued >= 0) return Promise.resolve(inbox.splice(queued, 1)[0]!);
    return new Promise<StreamMessage>((resolve, reject) => {
      waiters.push({ type, resolve });
      setTimeout(() => reject(new Error(`no "${type}" message`)), 3_000);
    });
  };
  return { socket, next, closed };
}

const ask = async () => {
  const [task] = (await captureTasks(ws.scout.ctx, { tasks: [{ title: "Pick a payroll provider", status: "todo" }] })).created;
  await requestInput(ws.scout.ctx, { taskId: task!.id, kind: "decision", question: "Gusto or Rippling?", options: ["Gusto", "Rippling"] });
  return task!;
};

describe("the realtime event stream", () => {
  it("pushes a person's answer to the agent that asked, and never the agent's own changes", async () => {
    const client = connect(ws.scout.token);
    const ready = (await client.next("ready")) as Extract<StreamMessage, { type: "ready" }>;
    expect(ready).toMatchObject({ agent: { id: ws.scout.agentId, name: "Scout" }, scope: "related", topics: ["decisions", "tasks", "goals", "memory"] });

    const task = await ask(); // Scout's own changes: none arrive.
    await answerInput(ws.human, { taskId: task.id, answer: "Gusto" });
    const pushed = (await client.next("events")) as Extract<StreamMessage, { type: "events" }>;
    expect(pushed.events).toEqual([
      expect.objectContaining({ action: "task.input_answered", entityId: task.id, reasons: ["asked_by_you", "watching:task"], url: `https://phean.test/w/${ws.tenant.slug}/decisions` }),
    ]);
    expect(pushed.cursor).toBe(pushed.events[0]!.eventId);
  });

  it("resumes after a cursor, so a reconnecting agent misses nothing and repeats nothing", async () => {
    const task = await ask();
    const first = connect(ws.scout.token);
    const { cursor } = (await first.next("ready")) as Extract<StreamMessage, { type: "ready" }>;
    first.socket.close();
    await updateTask(ws.human, { taskId: task.id, priority: "high" });
    await answerInput(ws.human, { taskId: task.id, answer: "Rippling" });

    const again = connect(ws.scout.token, `?after=${cursor}`);
    const pushed = (await again.next("events")) as Extract<StreamMessage, { type: "events" }>;
    expect(pushed.events.map((event) => event.action)).toEqual(["task.updated", "task.input_answered"]);
  });

  it("filters by topics and scope, and keeps other workspaces out", async () => {
    const other = await seedWorkspace(testDb.db, { name: "Globex", owner: "Eli" });
    const everything = connect(ws.closer.token, "?scope=all&topics=tasks");
    await everything.next("ready");
    await captureTasks(other.human, { tasks: [{ title: "Globex secret" }] });
    await captureTasks(ws.human, { tasks: [{ title: "Acme work" }] });
    const pushed = (await everything.next("events")) as Extract<StreamMessage, { type: "events" }>;
    expect(pushed.events.map((event) => event.summary)).toEqual([expect.stringContaining("Acme work")]);
    expect(pushed.events[0]!.reasons).toEqual(["workspace"]);
  });

  it("closes with 4401 once the agent is revoked, and refuses the token after", async () => {
    const client = connect(ws.scout.token);
    await client.next("ready");
    await revokeAgent(ws.human, { agentId: ws.scout.agentId });
    expect(await client.closed).toMatchObject({ code: CLOSE.revoked });
    const refused = connect(ws.scout.token);
    await expect(refused.closed).resolves.toMatchObject({ code: 1006 });
  });

  it("closes a sub-agent's stream once its parent's access ends, not only on revoke", async () => {
    const { token } = await createSubagent(ws.scout.ctx, { name: "Stream worker" });
    const client = connect(token);
    await client.next("ready");
    await testDb.db.update(agents).set({ accessExpiresAt: new Date(Date.now() - 1000) }).where(eq(agents.id, ws.scout.agentId));
    expect(await client.closed).toMatchObject({ code: CLOSE.revoked });
  });

  it("asks the agent to reconnect when its time is up, with the cursor to resume from", async () => {
    limits = { ...FAST, lifetimeMs: 150 };
    const client = connect(ws.scout.token);
    const { cursor } = (await client.next("ready")) as Extract<StreamMessage, { type: "ready" }>;
    expect(await client.next("reconnect")).toMatchObject({ type: "reconnect", cursor });
    expect(await client.closed).toMatchObject({ code: CLOSE.reconnect });
  });

  it("answers pings, caps open streams per agent, and drops oversized messages", async () => {
    limits = { ...FAST, maxPerAgent: 1 };
    const client = connect(ws.scout.token);
    await client.next("ready");
    client.socket.send(JSON.stringify({ type: "ping" }));
    expect(await client.next("pong")).toEqual({ type: "pong" });
    expect(await connect(ws.scout.token).closed).toMatchObject({ code: CLOSE.tooMany });
    client.socket.send("x".repeat(STREAM_LIMITS.maxClientMessage + 1));
    expect((await client.closed).code).toBe(1009);
  });

  it("still delivers an event that commits after a later one was sent (at least once, no gaps)", async () => {
    const client = connect(ws.closer.token, "?scope=all&topics=tasks");
    await client.next("ready");
    // An id taken by a transaction that commits late, after a later event is sent.
    const reserved = (await testDb.db.execute(sql`select nextval(pg_get_serial_sequence('events', 'id'))::int as id`)) as unknown as { rows: { id: number }[] };
    const lateId = reserved.rows[0]!.id;
    await captureTasks(ws.human, { tasks: [{ title: "Committed first" }] });
    const first = (await client.next("events")) as Extract<StreamMessage, { type: "events" }>;
    expect(first.events.map((event) => event.summary)).toEqual([expect.stringContaining("Committed first")]);
    await testDb.db.execute(
      sql`insert into events (id, tenant_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, data)
          overriding system value values (${lateId}, ${ws.tenant.id}, 'user', 'u_late', 'Dana', 'task.captured', 'task', 't_late', 'captured "Committed late"', '{}')`,
    );
    const late = (await client.next("events")) as Extract<StreamMessage, { type: "events" }>;
    expect(late.events.map((event) => event.eventId)).toEqual([lateId]);
  });

  it("caps streams across instances, counting a sub-agent's against the agent it works for", async () => {
    for (let index = 0; index < STREAM_LIMITS.maxPerAgent; index += 1) {
      await testDb.db.insert(realtimeStreams).values({ id: `rs_other_${ws.tenant.id}_${index}`, tenantId: ws.tenant.id, rootAgentId: ws.scout.agentId });
    }
    expect(await connect(ws.scout.token).closed).toMatchObject({ code: CLOSE.tooMany });
    expect(await connect(ws.scout.token, "", { headers: { "Phean-Agent-Name": "Research bot" } }).closed).toMatchObject({ code: CLOSE.tooMany });
    // Another agent in the workspace still has its own share, and another workspace's leases never count.
    const closer = connect(ws.closer.token);
    await closer.next("ready");
    const other = await seedWorkspace(testDb.db, { name: "Initech", owner: "Mo" });
    await connect(other.scout.token).next("ready");
  });

  it("says when the cursor asked for reaches back past the 24-hour replay", async () => {
    await testDb.db.execute(
      sql`insert into events (tenant_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, data, created_at)
          values (${ws.tenant.id}, 'user', 'u_old', 'Dana', 'task.captured', 'task', 't_old', 'captured "Old"', '{}', now() - interval '2 days')`,
    );
    const client = connect(ws.closer.token, "?after=0");
    expect(await client.next("ready")).toMatchObject({ truncated: true });
    expect(await connect(ws.closer.token).next("ready")).toMatchObject({ truncated: false });
  });

  it("survives junk sent on a refused stream, and starts from now for a cursor past the newest event", async () => {
    limits = { ...FAST, maxPerAgent: 1 };
    const open = connect(ws.closer.token, "?after=999999999&scope=all&topics=tasks");
    await open.next("ready");
    const refused = connect(ws.closer.token);
    refused.socket.on("open", () => refused.socket.send("x".repeat(STREAM_LIMITS.maxClientMessage * 2)));
    await refused.closed;
    await captureTasks(ws.human, { tasks: [{ title: "After the cursor" }] });
    const pushed = (await open.next("events")) as Extract<StreamMessage, { type: "events" }>;
    expect(pushed.events.map((event) => event.summary)).toEqual([expect.stringContaining("After the cursor")]);
  });

  it("takes the token as a subprotocol after phean.v1, without echoing it back", async () => {
    const client = connect(ws.scout.token, "", { protocols: [STREAM_PROTOCOL, `${TOKEN_PROTOCOL_PREFIX}${ws.scout.token}`] });
    await client.next("ready");
    expect(client.socket.protocol).toBe(STREAM_PROTOCOL);
  });
});

describe("stream credentials and options", () => {
  it("reads the token from Authorization or a second subprotocol, never the URL, and refuses a token offered first", () => {
    expect(streamToken(new Headers({ authorization: "Bearer phn_abc" }))).toEqual({ token: "phn_abc" });
    expect(streamToken(new Headers({ "sec-websocket-protocol": "phean.v1, phean.bearer.phn_abc" }))).toEqual({ token: "phn_abc" });
    expect(streamToken(new Headers({ "sec-websocket-protocol": "phean.bearer.phn_abc, phean.v1" }))).toMatchObject({ status: 400 });
    expect(streamToken(new Headers({ authorization: "Basic abc" }))).toMatchObject({ status: 401 });
    expect(streamToken(new Headers())).toMatchObject({ status: 401 });
  });

  it("validates topics, scope and the cursor", () => {
    expect(parseStreamOptions(new URL("https://x/api/events?topics=decisions,tasks&scope=all&after=42"))).toEqual({ topics: ["decisions", "tasks"], scope: "all", after: 42 });
    expect(parseStreamOptions(new URL("https://x/api/events?topics=secrets"))).toHaveProperty("error");
    expect(parseStreamOptions(new URL("https://x/api/events?scope=everyone"))).toHaveProperty("error");
    expect(parseStreamOptions(new URL("https://x/api/events?after=-1"))).toHaveProperty("error");
  });
});
