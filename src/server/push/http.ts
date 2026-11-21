import { createHash } from "node:crypto";

import type { Db } from "../db/client";
import type { Ctx } from "../domain/context";
import { isDomainError, type DomainErrorCode } from "../domain/errors";
import { answerFromNotification, INBOX_LIMIT, openDecisions, type InboxItem } from "../domain/notifications";
import { retractAnswer } from "../domain/tasks";
import { listMemberships, userContext } from "../domain/tenants";

/**
 * The oldest desktop shell the server still speaks to (docs/apps/CONTRACTS.md); an older one asks
 * its person to update.
 */
export const MIN_SHELL_VERSION = "0.1.0";

/** The header every shell and the service worker send. A cross-origin page cannot add it without a preflight, which Phean never answers. */
export const CLIENT_HEADER = "Phean-Client";
const CLIENTS = new Set(["desktop", "web"]);
const FETCH_SITES = new Set(["same-origin", "none"]);

const NO_STORE = { "cache-control": "no-store" };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

const STATUS: Record<DomainErrorCode, number> = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409 };

/** A domain refusal as the contract words it: a stale request is 409 `stale`. */
function refusal(error: unknown): Response {
  if (!isDomainError(error)) throw error;
  return json(STATUS[error.code], { error: error.code === "conflict" ? "stale" : error.code, message: error.message });
}

/**
 * The checks before any session is read, so a cross-site page gets nothing: the Phean-Client
 * header, a JSON body when one is posted, an Origin (when sent) of this deployment's, and a
 * Sec-Fetch-Site (when sent) of `same-origin` or `none`.
 */
export function clientRequestRefusal(request: Request, origins: readonly string[], { body }: { body: boolean }): Response | null {
  if (!CLIENTS.has(request.headers.get(CLIENT_HEADER) ?? "")) return json(400, { error: "invalid_request", message: `Send ${CLIENT_HEADER}: desktop or web.` });
  const origin = request.headers.get("origin");
  if (origin !== null && !origins.some((allowed) => new URL(allowed).origin === origin)) return json(403, { error: "forbidden", message: "Cross-origin requests are refused." });
  // The page itself sends same-origin; the desktop's main process sends none. A cross-site page can produce neither.
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && !FETCH_SITES.has(site)) return json(403, { error: "forbidden", message: "Cross-site requests are refused." });
  if (body && !(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json(415, { error: "invalid_request", message: "Send JSON." });
  }
  return null;
}

async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * Resolves the workspace for a signed-in person: null when there is no session (401). The route
 * builds it with `requireWorkspace(slug)`, which answers 404 for a workspace the person is not in.
 */
export type WorkspaceResolver = () => Promise<Ctx | null>;

export interface ClientDeps {
  /** Origins a browser may legitimately send (`trustedOrigins()`). */
  origins: readonly string[];
}

/** `POST /w/<slug>/push/answer`: an answer from a notification, by option index or as text. */
export async function handlePushAnswer(request: Request, workspace: WorkspaceResolver, { origins }: ClientDeps): Promise<Response> {
  const refused = clientRequestRefusal(request, origins, { body: true });
  if (refused) return refused;
  const ctx = await workspace();
  if (!ctx) return json(401, { error: "unauthorized", message: "Sign in to Phean again." });
  const body = await jsonBody(request);
  if (!body || typeof body !== "object") return json(400, { error: "invalid", message: "Send a JSON object." });
  // Only these fields: a label, a URL or anything else in the body is never read.
  const { taskId, requestId, option, answer } = body as Record<string, unknown>;
  try {
    return json(200, await answerFromNotification(ctx, { taskId, requestId, option, answer } as Parameters<typeof answerFromNotification>[1]));
  } catch (error) {
    return refusal(error);
  }
}

/** `POST /w/<slug>/push/undo`: takes back the answer just sent, until the agent has collected it. */
export async function handlePushUndo(request: Request, workspace: WorkspaceResolver, { origins }: ClientDeps): Promise<Response> {
  const refused = clientRequestRefusal(request, origins, { body: true });
  if (refused) return refused;
  const ctx = await workspace();
  if (!ctx) return json(401, { error: "unauthorized", message: "Sign in to Phean again." });
  const body = await jsonBody(request);
  if (!body || typeof body !== "object") return json(400, { error: "invalid", message: "Send a JSON object." });
  const { taskId, requestId } = body as Record<string, unknown>;
  try {
    await retractAnswer(ctx, { taskId, requestId } as Parameters<typeof retractAnswer>[1]);
    return json(200, {});
  } catch (error) {
    return refusal(error);
  }
}

export interface InboxFeed {
  pending: number;
  minShellVersion: string;
  items: InboxItem[];
}

/**
 * Every open request in the workspaces the person is a member of (never a platform admin's
 * read-only ones), each read with that workspace's own `Ctx`. A muted workspace still counts in
 * `pending` but lists nothing.
 */
export async function inboxFeed(db: Db, person: { id: string; name: string }): Promise<InboxFeed> {
  const memberships = await listMemberships(db, person.id);
  const decisions = await Promise.all(memberships.map((membership) => openDecisions(userContext(db, membership, person), {})));
  const items = decisions
    .filter((workspace) => !workspace.muted)
    .flatMap((workspace) => workspace.items)
    .sort((a, b) => b.askedAt.localeCompare(a.askedAt) || b.requestId.localeCompare(a.requestId))
    .slice(0, INBOX_LIMIT);
  return { pending: decisions.reduce((sum, workspace) => sum + workspace.pending, 0), minShellVersion: MIN_SHELL_VERSION, items };
}

export interface InboxDeps extends ClientDeps {
  db: Db;
  /** The signed-in person, or null without a live session. */
  person: { id: string; name: string } | null;
}

/** `GET /api/native/inbox`: the feed, with an ETag so an unchanged feed is a 304. */
export async function handleInbox(request: Request, { db, person, origins }: InboxDeps): Promise<Response> {
  const refused = clientRequestRefusal(request, origins, { body: false });
  if (refused) return refused;
  if (!person) return json(401, { error: "unauthorized", message: "Sign in to Phean again." });
  const body = JSON.stringify(await inboxFeed(db, person));
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = { ...NO_STORE, etag, "content-type": "application/json" };
  const seen = request.headers.get("if-none-match");
  if (seen && seen.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}
