import { timingSafeEqual } from "node:crypto";

import { and, count, desc, eq, gt, inArray, ne, notInArray, sql } from "drizzle-orm";

import { askerName, type RequestKind } from "@/lib/agent-sessions";
import { roleCan } from "@/lib/permissions";
import { PUSH_MAX_DEVICES } from "@/lib/push";


import { newId } from "../db/ids";
import type { Db } from "../db/client";
import { pushDeliveries, pushDevices, pushMutes, session, tasks } from "../db/schema";
import { assertPushEndpointSafe, UnsafePushEndpoint } from "../push/endpoints";
import { decryptSecret, encryptSecret } from "../webhooks/signing";
import type { Resolver } from "../webhooks/url-safety";
import { inTenant, inTransaction, type Ctx, type PersonCtx } from "./context";
import { forbidden, invalid, notFound } from "./errors";
import { assertCan } from "./policy";
import { DeviceEndpointInput, DeviceOptionsInput, DeviceRefInput, Empty, NotificationAnswerInput, NotificationUndoInput, RegisterDeviceInput } from "./schemas";
import { personService, service } from "./service";
import { answerInput, findTask, isAwaitingInput, retractAnswer } from "./tasks";
import { listMemberships } from "./tenants";

export { PUSH_MAX_DEVICES };
/** Different devices one person may turn on in a minute. */
export const PUSH_REGISTRATIONS_PER_MINUTE = 5;

/** A device as its person sees it on the Account page. */
export interface PushDevice {
  id: string;
  label: string;
  endpoint: string;
  answerFromNotification: boolean;
  private: boolean;
  /** Whether the session that turned it on is still signed in; answering from it needs one. */
  signedIn: boolean;
  createdAt: Date;
  lastSuccessAt: Date | null;
}

const deviceColumns = {
  id: pushDevices.id,
  label: pushDevices.label,
  endpoint: pushDevices.endpoint,
  answerFromNotification: pushDevices.answerFromNotification,
  private: pushDevices.private,
  createdAt: pushDevices.createdAt,
  lastSuccessAt: pushDevices.lastSuccessAt,
};

const signedIn = sql<boolean>`exists (select 1 from ${session} where ${session.id} = ${pushDevices.sessionId} and ${session.expiresAt} > now())`;

/** What only the adapter knows about the request: the session it arrived on, never from input. */
export interface RegisterContext {
  sessionId?: string | null;
  /** Tests resolve push hosts without DNS. */
  resolve?: Resolver;
}

const DEFAULT_LABEL = "This browser";

/** Whether a stored key (encrypted) is the one posted. A key the server can no longer read matches anything: that row can never be sent to again. */
function sameKey(ciphertext: string, posted: string): boolean {
  let stored: Buffer;
  try {
    stored = Buffer.from(decryptSecret(ciphertext), "base64url");
  } catch {
    return true;
  }
  const sent = Buffer.from(posted, "base64url");
  return stored.length === sent.length && timingSafeEqual(stored, sent);
}

/**
 * Turns on Decision notifications for this browser: its push subscription, for the person signed in.
 * Subscribing again from the same browser moves the device onto that person (with its options
 * reset and anything still queued for the one before dropped), so a shared browser never shows the
 * previous person's decisions; only the browser holding the subscription's keys can, so knowing an
 * endpoint is not enough to take someone's device. The person must be a member somewhere:
 * notifications are a member's. A person keeps at most `PUSH_MAX_DEVICES` (the oldest goes) and
 * turns on at most `PUSH_REGISTRATIONS_PER_MINUTE` different ones a minute.
 */
export const registerDevice = personService(RegisterDeviceInput, async (ctx: PersonCtx, input, extra?: RegisterContext): Promise<PushDevice> => {
  const memberships = await listMemberships(ctx.db, ctx.person.id);
  if (!memberships.some((membership) => roleCan(membership.role, "notify:subscribe"))) {
    throw forbidden("Join a workspace first: notifications are for the decisions waiting on you there.");
  }
  const [recent] = await ctx.db
    .select({ n: count() })
    .from(pushDevices)
    .where(and(eq(pushDevices.userId, ctx.person.id), ne(pushDevices.endpoint, input.endpoint), gt(pushDevices.registeredAt, sql`now() - interval '1 minute'`)));
  if ((recent?.n ?? 0) >= PUSH_REGISTRATIONS_PER_MINUTE) {
    throw invalid("You turned notifications on for several devices just now. Wait a minute, then try again.");
  }
  try {
    await assertPushEndpointSafe(input.endpoint, { resolve: extra?.resolve });
  } catch (error) {
    if (error instanceof UnsafePushEndpoint) throw invalid(error.message);
    throw error;
  }
  const label = input.label || DEFAULT_LABEL;
  const keys = { p256dhCiphertext: encryptSecret(input.keys.p256dh), authCiphertext: encryptSecret(input.keys.auth) };
  const sessionId = extra?.sessionId ?? null;

  return ctx.db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ id: pushDevices.id, userId: pushDevices.userId, p256dh: pushDevices.p256dhCiphertext, auth: pushDevices.authCiphertext })
      .from(pushDevices)
      .where(eq(pushDevices.endpoint, input.endpoint))
      .for("update");
    const moved = previous && previous.userId !== ctx.person.id;
    if (moved) {
      if (!sameKey(previous.p256dh, input.keys.p256dh) || !sameKey(previous.auth, input.keys.auth)) {
        throw forbidden("This browser's notifications belong to someone else. Turn them off there first, or subscribe again from this browser.");
      }
      await tx.delete(pushDeliveries).where(and(eq(pushDeliveries.deviceId, previous.id), eq(pushDeliveries.status, "pending")));
    }
    const registeredAt = new Date();
    const [device] = previous
      ? await tx
          .update(pushDevices)
          .set({ userId: ctx.person.id, ...keys, label, sessionId, failures: 0, registeredAt, ...(moved && { answerFromNotification: false, private: false, lastSuccessAt: null }) })
          .where(eq(pushDevices.id, previous.id))
          .returning(deviceColumns)
      : await tx
          .insert(pushDevices)
          .values({ id: newId("pd"), userId: ctx.person.id, endpoint: input.endpoint, ...keys, label, sessionId, registeredAt })
          .returning(deviceColumns);
    // The newest `PUSH_MAX_DEVICES` stay; a device left behind long ago goes first.
    const kept = tx
      .select({ id: pushDevices.id })
      .from(pushDevices)
      .where(eq(pushDevices.userId, ctx.person.id))
      .orderBy(desc(pushDevices.registeredAt), desc(pushDevices.id))
      .limit(PUSH_MAX_DEVICES);
    await tx.delete(pushDevices).where(and(eq(pushDevices.userId, ctx.person.id), notInArray(pushDevices.id, kept)));
    return { ...device!, signedIn: sessionId !== null };
  });
});

/**
 * Ties this browser's device to the session it is signed in with now, when the app loads: a device
 * whose session expired or was replaced then ends with this one. Only the person's own device; an
 * endpoint of anyone else's is left alone.
 */
export const tieDevice = personService(DeviceEndpointInput, async (ctx, { endpoint }, extra?: { sessionId: string | null }): Promise<{ tied: boolean }> => {
  const sessionId = extra?.sessionId ?? null;
  if (!sessionId) return { tied: false };
  const [own] = await ctx.db
    .update(pushDevices)
    .set({ sessionId })
    .where(and(eq(pushDevices.endpoint, endpoint), eq(pushDevices.userId, ctx.person.id), sql`${pushDevices.sessionId} is distinct from ${sessionId}`))
    .returning({ id: pushDevices.id });
  return { tied: Boolean(own) };
});

/** Signing out of this browser forgets its device by endpoint, whatever session it was tied to. */
export const forgetBrowserDevice = personService(DeviceEndpointInput, async (ctx, { endpoint }): Promise<{ forgotten: boolean }> => {
  const gone = await ctx.db
    .delete(pushDevices)
    .where(and(eq(pushDevices.endpoint, endpoint), eq(pushDevices.userId, ctx.person.id)))
    .returning({ id: pushDevices.id });
  return { forgotten: gone.length > 0 };
});

/** The person's devices, newest first. */
export async function listDevices(ctx: PersonCtx): Promise<PushDevice[]> {
  return ctx.db
    .select({ ...deviceColumns, signedIn })
    .from(pushDevices)
    .where(eq(pushDevices.userId, ctx.person.id))
    .orderBy(desc(pushDevices.createdAt));
}

const ownDevice = (ctx: PersonCtx, deviceId: string) => and(eq(pushDevices.id, deviceId), eq(pushDevices.userId, ctx.person.id));

/** Stops notifications on one of the person's devices. */
export const forgetDevice = personService(DeviceRefInput, async (ctx, { deviceId }): Promise<{ label: string }> => {
  const [gone] = await ctx.db.delete(pushDevices).where(ownDevice(ctx, deviceId)).returning({ label: pushDevices.label });
  if (!gone) throw notFound("device", deviceId);
  return gone;
});

/** Whether a device shows answer buttons, and whether it shows what agents wrote at all. */
export const setDeviceOptions = personService(DeviceOptionsInput, async (ctx, { deviceId, answerFromNotification, private: isPrivate }): Promise<PushDevice> => {
  const [current] = await ctx.db.select({ ...deviceColumns, signedIn }).from(pushDevices).where(ownDevice(ctx, deviceId));
  if (!current) throw notFound("device", deviceId);
  const patch = {
    ...(answerFromNotification !== undefined && answerFromNotification !== current.answerFromNotification && { answerFromNotification }),
    ...(isPrivate !== undefined && isPrivate !== current.private && { private: isPrivate }),
  };
  if (Object.keys(patch).length === 0) throw invalid("Nothing to change.");
  const [device] = await ctx.db.update(pushDevices).set(patch).where(ownDevice(ctx, deviceId)).returning(deviceColumns);
  return { ...device!, signedIn: current.signedIn };
});

/** Signing out or revoking a session ends the devices turned on in it. */
export async function forgetSessionDevices(db: Db, sessionIds: readonly string[]): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const gone = await db.delete(pushDevices).where(inArray(pushDevices.sessionId, [...sessionIds])).returning({ id: pushDevices.id });
  return gone.length;
}

/** The devices turned on in these sessions. */
export async function devicesOfSessions(db: Db, sessionIds: readonly string[]): Promise<string[]> {
  if (sessionIds.length === 0) return [];
  const rows = await db.select({ id: pushDevices.id }).from(pushDevices).where(inArray(pushDevices.sessionId, [...sessionIds]));
  return rows.map((row) => row.id);
}

/** Deletes these devices of the person, read before their sessions went. */
export async function forgetDevicesById(db: Db, userId: string, deviceIds: readonly string[]): Promise<void> {
  if (deviceIds.length === 0) return;
  await db.delete(pushDevices).where(and(eq(pushDevices.userId, userId), inArray(pushDevices.id, [...deviceIds])));
}

/** A session Better Auth replaced with a new one: its devices now end with the new one. */
export async function moveDevicesToSession(db: Db, userId: string, deviceIds: readonly string[], sessionId: string): Promise<void> {
  if (deviceIds.length === 0) return;
  await db.update(pushDevices).set({ sessionId }).where(and(eq(pushDevices.userId, userId), inArray(pushDevices.id, [...deviceIds])));
}

/** A password reset ends every device of the person, whatever session turned it on. */
export async function forgetAllDevices(db: Db, userId: string): Promise<number> {
  const gone = await db.delete(pushDevices).where(eq(pushDevices.userId, userId)).returning({ id: pushDevices.id });
  return gone.length;
}

/** The session ids of a person's sessions, for the sign-out hooks: all of them, or all but one. */
export async function sessionIdsOf(db: Db, userId: string, { except }: { except?: string } = {}): Promise<string[]> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(and(eq(session.userId, userId), except ? ne(session.id, except) : undefined));
  return rows.map((row) => row.id);
}

/** The session a token names, if it is the person's. */
export async function sessionIdOfToken(db: Db, userId: string, token: string): Promise<string | null> {
  const [row] = await db.select({ id: session.id }).from(session).where(and(eq(session.token, token), eq(session.userId, userId)));
  return row?.id ?? null;
}

function personOf(ctx: Ctx): string {
  if (ctx.actor.type !== "user") throw forbidden("Only people get Decision notifications.");
  return ctx.actor.id;
}

const ownMute = (ctx: Ctx, userId: string) => and(inTenant(ctx, pushMutes), eq(pushMutes.userId, userId));

/** Whether the acting person muted this workspace's notifications. */
export const isWorkspaceMuted = service(Empty, async (ctx): Promise<boolean> => {
  assertCan(ctx, "notify:subscribe");
  const [row] = await ctx.db.select({ userId: pushMutes.userId }).from(pushMutes).where(ownMute(ctx, personOf(ctx)));
  return Boolean(row);
});

/** No more notifications from this workspace, on any of the person's devices. */
export const muteWorkspace = service(Empty, async (ctx): Promise<{ muted: true }> => {
  assertCan(ctx, "notify:subscribe");
  const userId = personOf(ctx);
  await ctx.db.insert(pushMutes).values({ tenantId: ctx.tenant.id, userId }).onConflictDoNothing();
  // What was queued but not sent yet stays quiet too.
  await ctx.db
    .update(pushDeliveries)
    .set({ status: "dead", lastError: "muted" })
    .where(
      and(
        inTenant(ctx, pushDeliveries),
        eq(pushDeliveries.status, "pending"),
        eq(pushDeliveries.kind, "request"),
        inArray(pushDeliveries.deviceId, ctx.db.select({ id: pushDevices.id }).from(pushDevices).where(eq(pushDevices.userId, userId))),
      ),
    );
  return { muted: true };
});

export const unmuteWorkspace = service(Empty, async (ctx): Promise<{ muted: false }> => {
  assertCan(ctx, "notify:subscribe");
  await ctx.db.delete(pushMutes).where(ownMute(ctx, personOf(ctx)));
  return { muted: false };
});

/** One open request as the desktop's inbox feed lists it (CONTRACTS.md, "Inbox feed"). */
export interface InboxItem {
  requestId: string;
  taskId: string;
  slug: string;
  workspaceName: string;
  agentName: string;
  kind: RequestKind;
  question: string;
  options: string[];
  multiple: boolean;
  askedAt: string;
}

/** Requests listed per workspace, and in the feed. */
export const INBOX_LIMIT = 50;

export interface OpenDecisions {
  /** Every open request in the workspace, however many are listed. */
  pending: number;
  muted: boolean;
  /** The newest open requests, at most `INBOX_LIMIT`. */
  items: InboxItem[];
}

/**
 * The workspace's open requests, newest first, for the person's devices: only what a notification
 * shows, not the whole history.
 */
export const openDecisions = service(Empty, async (ctx): Promise<OpenDecisions> => {
  assertCan(ctx, "notify:subscribe");
  const userId = personOf(ctx);
  const [[total], rows, [mute]] = await Promise.all([
    ctx.db.select({ n: count() }).from(tasks).where(and(inTenant(ctx, tasks), isAwaitingInput)),
    ctx.db
      .select({ id: tasks.id, request: tasks.inputRequest })
      .from(tasks)
      .where(and(inTenant(ctx, tasks), isAwaitingInput))
      .orderBy(sql`${tasks.inputRequest}->>'askedAt' desc`, desc(tasks.id))
      .limit(INBOX_LIMIT),
    ctx.db.select({ userId: pushMutes.userId }).from(pushMutes).where(ownMute(ctx, userId)),
  ]);
  return {
    pending: total?.n ?? 0,
    muted: Boolean(mute),
    items: rows.map(({ id, request }) => ({
      requestId: request!.id,
      taskId: id,
      slug: ctx.tenant.slug,
      workspaceName: ctx.tenant.name,
      agentName: askerName(request!),
      kind: request!.kind,
      question: request!.question,
      options: request!.options,
      multiple: Boolean(request!.multiple),
      askedAt: request!.askedAt,
    })),
  };
});

export interface NotificationAnswer {
  answer: string;
  taskTitle: string;
  agentName: string;
}

/**
 * Answers from a notification: a button's `option` is an index into the open request's options,
 * so the label always comes from the request, never from the device. Only that request is answered
 * (`answerInput` refuses a stale one). A request that takes several answers has no buttons.
 */
export const answerFromNotification = service(NotificationAnswerInput, async (ctx, { taskId, requestId, option, answer: written, endpoint }): Promise<NotificationAnswer> => {
  assertCan(ctx, "task:write");
  personOf(ctx);
  return inTransaction(ctx, async (tx) => {
    const current = await findTask(tx, taskId, { lock: true });
    const open = current.inputRequest;
    let answer = written;
    if (option !== undefined) {
      if (open && open.id === requestId) {
        if (open.multiple) throw invalid(`${open.agentName} asked for several answers. Open the decision in Phean to pick them.`);
        answer = open.options[option];
        if (answer === undefined) throw invalid("That option is not on the request.");
      }
    }
    // A stale request id, or none open, is refused by answerInput itself (conflict).
    await answerInput(tx, { taskId, requestId, answer: answer ?? "" });
    // The answering device shows "Sent", with Undo: only the others have theirs replaced.
    if (endpoint) await settleOnDevice(tx, endpoint, requestId, "resolved");
    return { answer: answer ?? "", taskTitle: current.title, agentName: open ? askerName(open) : "" };
  });
});

/**
 * Undo from a notification: `retractAnswer`, and the request is open again on every device but the
 * one that undid it, which shows the request itself.
 */
export const undoFromNotification = service(NotificationUndoInput, async (ctx, { taskId, requestId, endpoint }): Promise<void> => {
  assertCan(ctx, "task:write");
  personOf(ctx);
  await inTransaction(ctx, async (tx) => {
    await retractAnswer(tx, { taskId, requestId });
    if (endpoint) await settleOnDevice(tx, endpoint, requestId, "request");
  });
});

/**
 * The push the acting device needs no more, queued in this transaction (the sender starts after
 * commit): its own `resolved` is dropped, and its `request` counts as shown, so a later answer
 * elsewhere still replaces it. Only the acting person's own device, named by its endpoint.
 */
async function settleOnDevice(tx: Ctx, endpoint: string, requestId: string, kind: "request" | "resolved"): Promise<void> {
  const own = tx.db
    .select({ id: pushDevices.id })
    .from(pushDevices)
    .where(and(eq(pushDevices.endpoint, endpoint), eq(pushDevices.userId, personOf(tx))));
  await tx.db
    .update(pushDeliveries)
    .set(kind === "resolved" ? { status: "dead", lastError: "answered_here" } : { status: "sent", sentAt: new Date(), lastError: null })
    .where(
      and(
        inTenant(tx, pushDeliveries),
        eq(pushDeliveries.requestId, requestId),
        eq(pushDeliveries.kind, kind),
        eq(pushDeliveries.status, "pending"),
        inArray(pushDeliveries.deviceId, own),
      ),
    );
}
