import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { askerName, type RequestKind } from "@/lib/agent-sessions";
import { roleCan } from "@/lib/permissions";

import { newId } from "../db/ids";
import type { Db } from "../db/client";
import { pushDeliveries, pushDevices, pushMutes, session, tasks } from "../db/schema";
import { assertPushEndpointSafe, UnsafePushEndpoint } from "../push/endpoints";
import { encryptSecret } from "../webhooks/signing";
import type { Resolver } from "../webhooks/url-safety";
import { inTenant, type Ctx, type PersonCtx } from "./context";
import { forbidden, invalid, notFound } from "./errors";
import { assertCan } from "./policy";
import { DeviceOptionsInput, DeviceRefInput, Empty, NotificationAnswerInput, RegisterDeviceInput } from "./schemas";
import { personService, service } from "./service";
import { answerInput, findTask, isAwaitingInput } from "./tasks";
import { listMemberships } from "./tenants";

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

/**
 * Turns on Decision notifications for this browser: its push subscription, for the person signed in.
 * Subscribing again from the same browser moves the device onto that person (with its options
 * reset and anything still queued for the one before dropped), so a shared browser never shows the
 * previous person's decisions. The person must be a member somewhere: notifications are a member's.
 */
export const registerDevice = personService(RegisterDeviceInput, async (ctx: PersonCtx, input, extra?: RegisterContext): Promise<PushDevice> => {
  const memberships = await listMemberships(ctx.db, ctx.person.id);
  if (!memberships.some((membership) => roleCan(membership.role, "notify:subscribe"))) {
    throw forbidden("Join a workspace first: notifications are for the decisions waiting on you there.");
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
    const [previous] = await tx.select({ id: pushDevices.id, userId: pushDevices.userId }).from(pushDevices).where(eq(pushDevices.endpoint, input.endpoint)).for("update");
    if (previous && previous.userId !== ctx.person.id) {
      await tx.delete(pushDeliveries).where(and(eq(pushDeliveries.deviceId, previous.id), eq(pushDeliveries.status, "pending")));
    }
    const moved = previous && previous.userId !== ctx.person.id;
    const [device] = previous
      ? await tx
          .update(pushDevices)
          .set({ userId: ctx.person.id, ...keys, label, sessionId, failures: 0, ...(moved && { answerFromNotification: false, private: false, lastSuccessAt: null }) })
          .where(eq(pushDevices.id, previous.id))
          .returning(deviceColumns)
      : await tx
          .insert(pushDevices)
          .values({ id: newId("pd"), userId: ctx.person.id, endpoint: input.endpoint, ...keys, label, sessionId })
          .returning(deviceColumns);
    return { ...device!, signedIn: sessionId !== null };
  });
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
export const answerFromNotification = service(NotificationAnswerInput, async (ctx, { taskId, requestId, option, answer: written }): Promise<NotificationAnswer> => {
  assertCan(ctx, "task:write");
  personOf(ctx);
  const current = await findTask(ctx, taskId);
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
  await answerInput(ctx, { taskId, requestId, answer: answer ?? "" });
  return { answer: answer ?? "", taskTitle: current.title, agentName: open ? askerName(open) : "" };
});
