import { and, asc, count, eq, gt, lt, lte, max, notInArray, or, sql } from "drizzle-orm";

import { WEBHOOK_TOPICS, type WebhookTopic } from "@/lib/domain";

import type { Db } from "../db/client";
import { newId } from "../db/ids";
import { agents, events, realtimeStreams, watches } from "../db/schema";
import { liveAgent } from "../domain/agent-liveness";
import type { AgentPrincipal } from "../domain/agents";
import { eventUrl } from "../webhooks/dispatch";
import { concerns, reasonsFor, topicsOf, type Listener, type RoutedEvent } from "../webhooks/routing";

/**
 * The realtime event stream an agent opens over a WebSocket (`/api/events`): the same events, for
 * the same reasons, that its webhook would get, pushed as they happen. Phean reads the event log
 * after a cursor every couple of seconds, so it needs no broker and any instance can serve any
 * agent; each connection ends on its own before the function's time runs out, saying where it
 * stopped, and the agent reconnects with `after`. Delivery is at least once (see runEventStream).
 */
export const STREAM_LIMITS = {
  /** How often the log is read for new events. */
  pollMs: 2_000,
  /** WebSocket pings, so idle proxies keep the connection and dead peers are noticed. */
  heartbeatMs: 25_000,
  /** How long a connection lives before it asks the agent to reconnect; under the route's maxDuration. */
  lifetimeMs: 270_000,
  /** How often the agent's access is checked again, so a revoked token is cut off. */
  recheckMs: 30_000,
  /** Events read per poll; a full batch is followed at once by the next. */
  batch: 100,
  /** Largest message an agent may send (only `{"type":"ping"}` is understood). */
  maxClientMessage: 4_096,
  /** Unsent bytes allowed to pile up before a slow reader is dropped. */
  maxBuffered: 1_048_576,
  /** Open streams per agent (its sub-agents count towards it) and per workspace, across instances. */
  maxPerAgent: 5,
  maxPerWorkspace: 50,
  /** Open streams on one server instance, a backstop for its database connections. */
  maxPerInstance: 200,
} as const;

export type StreamLimits = Record<keyof typeof STREAM_LIMITS, number>;

/** Close codes the stream uses, besides the standard ones. */
export const CLOSE = {
  /** Time is up for this connection: reconnect with `after` set to the cursor it sent last. */
  reconnect: 4000,
  /** The agent lost access: revoked, expired, or its approver or parent gone. */
  revoked: 4401,
  /** Too many open streams for this agent or workspace, or on this server. */
  tooMany: 4429,
} as const;

export interface StreamOptions {
  topics: WebhookTopic[];
  scope: Listener["scope"];
  /** The last event id the agent has; omitted, the stream starts from now. */
  after: number | null;
}

/** Reads `topics`, `scope` and `after` from the stream URL, or says what is wrong. */
export function parseStreamOptions(url: URL): StreamOptions | { error: string } {
  const rawTopics = url.searchParams.get("topics");
  const topics = rawTopics ? [...new Set(rawTopics.split(",").map((topic) => topic.trim()).filter(Boolean))] : [...WEBHOOK_TOPICS];
  const unknown = topics.filter((topic) => !(WEBHOOK_TOPICS as readonly string[]).includes(topic));
  if (unknown.length || topics.length === 0) return { error: `topics must be a comma-separated list of ${WEBHOOK_TOPICS.join(", ")}.` };
  const scope = url.searchParams.get("scope") ?? "related";
  if (scope !== "related" && scope !== "all") return { error: 'scope must be "related" or "all".' };
  const rawAfter = url.searchParams.get("after");
  if (rawAfter !== null && !/^\d{1,15}$/.test(rawAfter)) return { error: "after must be an event id (a whole number) from an earlier message." };
  return { topics: topics as WebhookTopic[], scope, after: rawAfter === null ? null : Number(rawAfter) };
}

/** The part of a `ws` WebSocket the stream uses, so tests can drive it with any socket. */
export interface StreamSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: "message", listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: "pong" | "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

const OPEN = 1;
/** Streams open on this instance, a backstop beneath the leases that cap them everywhere. */
let openHere = 0;
export interface StreamEvent {
  eventId: number;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  actor: { type: string; id: string; name: string };
  data: Record<string, unknown>;
  createdAt: string;
  reasons: string[];
  url: string;
}

/** The messages an agent receives; each is one JSON text frame. */
export type StreamMessage =
  | {
      type: "ready";
      agent: { id: string; name: string };
      workspace: { slug: string; name: string };
      topics: WebhookTopic[];
      scope: Listener["scope"];
      cursor: number;
      reconnectAt: string;
      /** The `after` asked for reaches back past the 24-hour replay: some events are not replayed; read get_activity for them. */
      truncated: boolean;
    }
  | { type: "events"; events: StreamEvent[]; cursor: number }
  | { type: "reconnect"; cursor: number; reason: string }
  | { type: "pong" };

interface StreamDeps {
  db: Db;
  principal: AgentPrincipal;
  options: StreamOptions;
  /** Public origin for the links in events. */
  origin: string;
  limits?: Partial<StreamLimits>;
  /** When the platform ends this invocation; the stream asks the agent to reconnect well before. */
  deadline?: Date;
}

/** Leeway before the invocation's deadline for the reconnect message and the close to go out. */
const DEADLINE_MARGIN_MS = 15_000;

/**
 * Serves one agent's stream on an upgraded socket until it closes. Resolves once the socket is
 * closed, whoever closed it. Never throws, and never lets a socket error reach the process: a
 * failure closes the socket with 1011.
 *
 * Delivery is at least once. Event ids come from one sequence but commit in any order, so an
 * event can appear below the cursor after a later one was sent; each read therefore also looks
 * back over the last minute and sends what it has not sent yet, and a reconnect may repeat recent
 * events. Agents de-duplicate by `eventId`, as they do for webhooks.
 */
export function runEventStream(socket: StreamSocket, { db, principal, options, origin, limits: overrides, deadline }: StreamDeps): Promise<void> {
  const limits: StreamLimits = { ...STREAM_LIMITS, ...overrides };
  if (deadline) limits.lifetimeMs = Math.max(5_000, Math.min(limits.lifetimeMs, deadline.getTime() - Date.now() - DEADLINE_MARGIN_MS));
  const agentId = principal.agent.id;
  const tenantId = principal.tenant.id;
  const listener: Listener = { agentId, topics: options.topics, scope: options.scope };
  const timers: ReturnType<typeof setInterval>[] = [];
  /** Event ids sent in the look-back window, with when they were sent. */
  const sent = new Map<number, number>();
  let cursor = 0;
  /** Late commits are looked for above this: the cursor a fresh stream started at, so it does not replay the last minute. */
  let lateFloor = 0;
  let closed = false;
  let polling = false;
  let alive = true;
  let failedChecks = 0;
  let lease: string | null = null;
  let countedHere = false;

  const end = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    for (const timer of timers) clearInterval(timer);
    if (socket.readyState === OPEN) socket.close(code, reason);
  };
  const send = (message: StreamMessage) => {
    if (closed || socket.readyState !== OPEN) return;
    if (socket.bufferedAmount > limits.maxBuffered) return end(1013, "Reading too slowly; reconnect with after");
    socket.send(JSON.stringify(message));
  };

  return new Promise<void>((resolve) => {
    // First of all: a socket error (an oversized frame, a reset) must never become an uncaught
    // exception, even on a stream refused a moment later.
    socket.on("error", (error) => {
      console.warn("[realtime] socket error", error.message);
      end(1011, "Connection error");
    });
    socket.on("close", () => {
      closed = true;
      for (const timer of timers) clearInterval(timer);
      if (countedHere) openHere -= 1;
      if (lease) void releaseLease(db, lease).catch((error: unknown) => console.error("[realtime] lease release failed", error));
      resolve();
    });
    // Agents only ping; anything else is ignored, and anything too large ends the stream.
    socket.on("message", (data, isBinary) => {
      const text = isBinary ? null : String(data);
      if (!text || text.length > limits.maxClientMessage) return end(1009, "Messages to Phean are pings only");
      try {
        if ((JSON.parse(text) as { type?: unknown }).type === "ping") send({ type: "pong" });
      } catch {
        // Not JSON: ignored.
      }
    });
    socket.on("pong", () => {
      alive = true;
    });

    const deliver = async (rows: (typeof events.$inferSelect)[]) => {
      const fresh = rows.filter((row) => !sent.has(row.id));
      const delivered = fresh.length ? await route(db, tenantId, listener, fresh, principal.tenant.slug, origin) : [];
      const now = Date.now();
      for (const row of fresh) sent.set(row.id, now);
      return delivered;
    };

    const poll = async () => {
      if (polling || closed) return;
      polling = true;
      try {
        // Late commits: events below the cursor from the last minute, not sent yet.
        const alreadySent = [...sent.keys()];
        const late = await db
          .select()
          .from(events)
          .where(
            and(
              eq(events.tenantId, tenantId),
              lte(events.id, cursor),
              gt(events.id, lateFloor),
              gt(events.createdAt, sql`now() - ${LATE_WINDOW}::interval`),
              alreadySent.length ? notInArray(events.id, alreadySent) : undefined,
            ),
          )
          .orderBy(asc(events.id))
          .limit(limits.batch * MAX_BATCHES_PER_POLL);
        const lateDelivered = await deliver(late);
        if (lateDelivered.length) send({ type: "events", events: lateDelivered, cursor });

        // New events, a bounded number of batches per poll so a long catch-up yields to the timers.
        for (let batch = 0; batch < MAX_BATCHES_PER_POLL && !closed; batch += 1) {
          const rows = await db
            .select()
            .from(events)
            .where(and(eq(events.tenantId, tenantId), gt(events.id, cursor), gt(events.createdAt, sql`now() - ${REPLAY_WINDOW}::interval`)))
            .orderBy(asc(events.id))
            .limit(limits.batch);
          if (rows.length === 0) break;
          const delivered = await deliver(rows);
          cursor = rows.at(-1)!.id;
          if (delivered.length) send({ type: "events", events: delivered, cursor });
          if (rows.length < limits.batch) break;
        }
        const forgetBefore = Date.now() - SENT_MEMORY_MS;
        for (const [id, at] of sent) if (at < forgetBefore || sent.size > MAX_SENT_REMEMBERED) sent.delete(id);
      } catch (error) {
        console.error("[realtime] poll failed", error);
        end(1011, "Phean could not read events; reconnect with after");
      } finally {
        polling = false;
      }
    };

    // An agent that loses access (revoked, expired, its approver or parent gone) is cut off, and the lease is renewed.
    const recheck = async () => {
      try {
        const [row] = await db.select({ live: sql<boolean>`(${liveAgent()})` }).from(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.id, agentId)));
        if (!row?.live) return end(CLOSE.revoked, "This agent no longer has access");
        if (lease) await db.update(realtimeStreams).set({ renewedAt: new Date() }).where(eq(realtimeStreams.id, lease));
        failedChecks = 0;
      } catch (error) {
        console.error("[realtime] access check failed", error);
        failedChecks += 1;
        // Two missed renewals end the stream while its lease (90 s) is still held.
        if (failedChecks >= 2) end(1011, "Phean could not check access; reconnect with after");
      }
    };

    void (async () => {
      try {
        if (openHere >= limits.maxPerInstance) return end(CLOSE.tooMany, "This server is full; reconnect shortly");
        openHere += 1;
        countedHere = true;
        lease = await acquireLease(db, principal, limits);
        if (!lease) return end(CLOSE.tooMany, "Too many open streams; close one first");
        // Closed while the lease was being taken: the close handler ran without it.
        if (closed) return void releaseLease(db, lease).catch(() => undefined);

        const [latest] = await db.select({ id: max(events.id) }).from(events).where(eq(events.tenantId, tenantId));
        const head = latest?.id ?? 0;
        // A cursor past the newest event (a typo, another workspace's id) starts from now.
        cursor = options.after === null ? head : Math.min(options.after, head);
        if (options.after === null) lateFloor = head;
        const truncated =
          options.after !== null &&
          (
            await db
              .select({ id: events.id })
              .from(events)
              .where(and(eq(events.tenantId, tenantId), gt(events.id, options.after), lte(events.createdAt, sql`now() - ${REPLAY_WINDOW}::interval`)))
              .limit(1)
          ).length > 0;

        // Timers first, so a long catch-up still heartbeats, rechecks access and ends on time.
        timers.push(setInterval(() => void poll(), limits.pollMs));
        timers.push(setInterval(() => void recheck(), limits.recheckMs));
        timers.push(
          setInterval(() => {
            // No pong since the last ping: the peer is gone.
            if (!alive) return socket.terminate();
            alive = false;
            socket.ping();
          }, limits.heartbeatMs),
        );
        timers.push(
          setInterval(() => {
            send({ type: "reconnect", cursor, reason: "This connection's time is up; reconnect with after set to cursor" });
            end(CLOSE.reconnect, "Reconnect with after");
          }, limits.lifetimeMs),
        );
        send({
          type: "ready",
          agent: principal.agent,
          workspace: { slug: principal.tenant.slug, name: principal.tenant.name },
          topics: options.topics,
          scope: options.scope,
          cursor,
          reconnectAt: new Date(Date.now() + limits.lifetimeMs).toISOString(),
          truncated,
        });
        await poll();
      } catch (error) {
        console.error("[realtime] stream failed to start", error);
        end(1011, "Phean could not start the stream");
      }
    })();
  });
}

/** How far back each read looks for events that committed after a later one was sent. */
const LATE_WINDOW = "60 seconds";
/** How long sent ids are remembered; longer than the late window. */
const SENT_MEMORY_MS = 120_000;
/** The oldest events a stream replays: a day, like a webhook's useful history, not the workspace's whole log. */
const REPLAY_WINDOW = "24 hours";
/** Sent ids remembered at most, so a very busy workspace cannot grow a stream's memory without end. */
const MAX_SENT_REMEMBERED = 5_000;
/** Batches one poll reads before yielding to the timers. */
const MAX_BATCHES_PER_POLL = 5;
/** A lease not renewed for this long belongs to a stream that is gone. */
const LEASE_TTL = "90 seconds";

/**
 * Takes a lease for a new stream, or null when the agent (with its sub-agents) or the workspace
 * already has its share open, across every instance.
 */
async function acquireLease(db: Db, principal: AgentPrincipal, limits: StreamLimits): Promise<string | null> {
  const tenantId = principal.tenant.id;
  const [self] = await db.select({ parent: agents.parentAgentId }).from(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.id, principal.agent.id)));
  const rootAgentId = self?.parent ?? principal.agent.id;
  // One workspace's streams are counted and taken one at a time, so parallel connects cannot all pass the check.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`realtime:${tenantId}`}))`);
    await tx.delete(realtimeStreams).where(and(eq(realtimeStreams.tenantId, tenantId), lt(realtimeStreams.renewedAt, sql`now() - ${LEASE_TTL}::interval`)));
    const [counts] = await tx
      .select({
        workspace: count(),
        agent: sql<number>`count(*) filter (where ${realtimeStreams.rootAgentId} = ${rootAgentId})`,
      })
      .from(realtimeStreams)
      .where(eq(realtimeStreams.tenantId, tenantId));
    if (Number(counts?.agent ?? 0) >= limits.maxPerAgent || Number(counts?.workspace ?? 0) >= limits.maxPerWorkspace) return null;
    const id = newId("rs");
    await tx.insert(realtimeStreams).values({ id, tenantId, rootAgentId });
    return id;
  });
}

async function releaseLease(db: Db, id: string): Promise<void> {
  await db.delete(realtimeStreams).where(eq(realtimeStreams.id, id));
}

/** Keeps the events `listener` hears, with why, shaped as the webhook payload's events are. */
async function route(db: Db, tenantId: string, listener: Listener, rows: (typeof events.$inferSelect)[], slug: string, origin: string): Promise<StreamEvent[]> {
  const routable = rows.filter((row) => topicsOf(row.action).length > 0);
  if (routable.length === 0) return [];
  const keys = routable.flatMap((row) => concerns(row as RoutedEvent));
  const watched = keys.length
    ? await db
        .select({ type: watches.entityType, id: watches.entityId })
        .from(watches)
        .where(
          and(
            eq(watches.tenantId, tenantId),
            eq(watches.agentId, listener.agentId),
            or(...keys.map((key) => sql`(${watches.entityType} = ${key.type} and ${watches.entityId} = ${key.id})`)),
          ),
        )
    : [];
  const watching = new Set(watched.map((row) => `${row.type}|${row.id}`));
  return routable.flatMap((row) => {
    const reasons = reasonsFor(row as RoutedEvent, listener, watching, row.actorType === "agent" ? row.actorId : null);
    if (reasons.length === 0) return [];
    return [
      {
        eventId: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: `${row.actorName} ${row.summary}`,
        actor: { type: row.actorType, id: row.actorId, name: row.actorName },
        data: row.data,
        createdAt: row.createdAt.toISOString(),
        reasons,
        url: eventUrl(origin, slug, row.entityType, row.entityId, row.action),
      },
    ];
  });
}
