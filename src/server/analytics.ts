import "server-only";

import { createHash } from "node:crypto";

import { waitUntil } from "@vercel/functions";

import { cleanParams, EVENTS, workspaceCountBucket, type AnalyticsIdentityParams, type EventName, type EventParams } from "@/lib/analytics";

/**
 * Google Analytics on the server (docs/ANALYTICS.md): whether pages load it, the salted hashes that
 * stand for people and workspaces, and the Measurement Protocol for what agents do with no page open.
 */

export interface AnalyticsConfig {
  measurementId: string;
  /** Previews send with `debug_mode`, so their events show in DebugView and stay out of reports. */
  debug: boolean;
}

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

/** The cookie the UI tests set to turn analytics on for one browser, honoured only where `PHEAN_ANALYTICS_TEST_ID` is set. */
export const ANALYTICS_TEST_COOKIE = "phean-analytics-test";

/**
 * Whether pages load GA, and with which id: only on Vercel production and previews with the id set.
 * Never in development or tests, except a UI test that asks for it (`ANALYTICS_TEST_COOKIE`) on a
 * server started with a test id.
 */
export function analyticsConfig(testCookie?: string): AnalyticsConfig | null {
  const env = process.env.VERCEL_ENV;
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  if ((env === "production" || env === "preview") && id && MEASUREMENT_ID.test(id)) return { measurementId: id, debug: env === "preview" };
  const testId = process.env.PHEAN_ANALYTICS_TEST_ID?.trim();
  if (!env && testId && MEASUREMENT_ID.test(testId) && testCookie === "1") return { measurementId: testId, debug: true };
  return null;
}

/**
 * The id GA knows a person or workspace by: a SHA-256 of the internal id and `ANALYTICS_ID_SALT`,
 * which only the server holds, so GA's ids cannot be joined back to Phean's. No salt, no id.
 */
export function analyticsHash(kind: "user" | "workspace", id: string): string | undefined {
  const salt = process.env.ANALYTICS_ID_SALT;
  if (!salt || !id) return undefined;
  return createHash("sha256").update(`${salt}:${kind}:${id}`).digest("hex").slice(0, 32);
}

const ROLES = new Set(["owner", "admin", "member"]);

/**
 * Who is viewing an app page, as GA may know it: the hashed person, the hashed workspace and the
 * role in it (a platform admin's read-only view has none), and the user properties.
 */
export function analyticsIdentity(viewer: { user: { id: string }; memberships: readonly unknown[] }, membership?: { tenant: { id: string }; role: string }): AnalyticsIdentityParams {
  const role = membership && ROLES.has(membership.role) ? (membership.role as AnalyticsIdentityParams["role"]) : undefined;
  return {
    signed_in: true,
    user_id: analyticsHash("user", viewer.user.id),
    workspace_hash: membership ? analyticsHash("workspace", membership.tenant.id) : undefined,
    role,
    user_properties: { workspace_count_bucket: workspaceCountBucket(viewer.memberships.length) },
  };
}

// ---------------------------------------------------------------------------------------------------
// Measurement Protocol
// ---------------------------------------------------------------------------------------------------

export interface ServerEvent<N extends EventName = EventName> {
  name: N;
  params?: EventParams<N>;
  /** The internal id of the person it is about (the agent's approver), hashed before it is sent. */
  userId?: string | null;
  /** The internal id of the workspace, hashed before it is sent. */
  tenantId?: string | null;
}

type Sender = (body: unknown) => Promise<void>;

const COLLECT_URL = "https://www.google-analytics.com/mp/collect";

async function postToGoogle(body: unknown): Promise<void> {
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  const secret = process.env.GA_API_SECRET;
  if (!id || !secret) return;
  const url = `${COLLECT_URL}?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(secret)}`;
  await fetch(url, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
}

let sender: Sender | null = null;

/** Tests capture what would be sent; `null` restores the real sender. */
export function setAnalyticsSender(capture: Sender | null): void {
  sender = capture;
}

/** The server sends only on production (where `GA_API_SECRET` lives), or to a test's sender. */
function activeSender(): Sender | null {
  if (sender) return sender;
  if (process.env.VERCEL_ENV !== "production" || !process.env.GA_API_SECRET || !process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID) return null;
  return postToGoogle;
}

/** The Measurement Protocol body for one event, with the catalog's params only. Exported for the tests. */
export function serverEventBody(event: ServerEvent): Record<string, unknown> | null {
  const spec = EVENTS[event.name];
  if (!("server" in spec)) return null;
  const userHash = event.userId ? analyticsHash("user", event.userId) : undefined;
  const workspaceHash = event.tenantId ? analyticsHash("workspace", event.tenantId) : undefined;
  const subject = userHash ?? workspaceHash;
  // GA needs a client id; the server's events have no browser, so it is the hash they are about.
  if (!subject) return null;
  const params: Record<string, unknown> = {
    ...cleanParams(spec.params, (event.params ?? {}) as Record<string, unknown>),
    surface: "app",
    source_side: "server",
    engagement_time_msec: 1,
    ...(workspaceHash ? { workspace_hash: workspaceHash } : {}),
  };
  return {
    client_id: `srv.${subject}`,
    ...(userHash ? { user_id: userHash } : {}),
    non_personalized_ads: true,
    events: [{ name: event.name, params }],
  };
}

/**
 * Sends events over the Measurement Protocol in the background: never awaited by the request, never
 * throws. Call it from `onCommit` (or after the work is durable), so a rolled-back change sends nothing.
 */
export function sendServerEvents(...events: ServerEvent[]): void {
  const send = activeSender();
  if (!send) return;
  for (const event of events) {
    let body: Record<string, unknown> | null;
    try {
      body = serverEventBody(event);
    } catch {
      continue;
    }
    if (!body) continue;
    const delivery = send(body).catch(() => {});
    try {
      waitUntil(delivery);
    } catch {
      // Outside a request (a script, a test): the promise runs on its own.
    }
  }
}
