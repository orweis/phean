import { createECDH, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { pushDeliveries } from "@/server/db/schema";
import { personContext } from "@/server/domain/context";
import { registerDevice, setDeviceOptions, type PushDevice } from "@/server/domain/notifications";
import type { PushMessage, PushResult, PushSender } from "@/server/push/dispatch";
import type { Resolver } from "@/server/webhooks/url-safety";

/** Push hosts resolve to a public address without DNS. */
export const publicResolver: Resolver = async () => ["142.250.80.10"];

/** A browser's PushSubscription: a fresh P-256 key and auth secret, on an FCM endpoint. */
export function subscription(endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("base64url")}`) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

/** Turns notifications on for `person` from a new browser (or `endpoint`), with options. */
export async function deviceFor(
  db: Db,
  person: { id: string; name: string },
  { endpoint, sessionId = null, label = "Chrome on Android", ...options }: { endpoint?: string; sessionId?: string | null; label?: string; answerFromNotification?: boolean; private?: boolean } = {},
): Promise<PushDevice> {
  const ctx = personContext(db, person);
  const device = await registerDevice(ctx, { ...subscription(endpoint), label }, { sessionId, resolve: publicResolver });
  if (options.answerFromNotification === undefined && options.private === undefined) return device;
  return setDeviceOptions(ctx, { deviceId: device.id, ...options });
}

/** A fake push service: records what it was sent, answers `status` (or what `answer` says). */
export function fakePushService(answer: (message: PushMessage) => number = () => 201) {
  const sent: (PushMessage & { body: Record<string, unknown> })[] = [];
  const send: PushSender = async (message): Promise<PushResult> => {
    sent.push({ ...message, body: JSON.parse(message.payload) as Record<string, unknown> });
    const status = answer(message);
    return { status, error: status >= 200 && status < 300 ? null : `HTTP ${status}` };
  };
  return { sent, send, deps: { send, budgetMs: 5_000 } };
}

/** The outbox rows of one device, oldest first. */
export async function deliveriesOf(db: Db, deviceId: string) {
  return db.select().from(pushDeliveries).where(eq(pushDeliveries.deviceId, deviceId)).orderBy(pushDeliveries.id);
}
