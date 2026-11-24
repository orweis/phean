import { isLinkableId } from "./links";
import { APP_ICON_SIZES, routes, type NotificationBadge } from "./routes";

/**
 * The service worker's pure parts: a Web Push payload (docs/apps/CONTRACTS.md, "Web Push payload")
 * to the notification it shows, the address a click opens, the calls its buttons make, and what it
 * keeps for offline. `lib/service-worker.ts` wires them to the worker's events, and
 * `scripts/service-worker.ts` bundles both into `public/sw.js`. Client-safe and free of the DOM.
 */

/** The payload versions this worker understands. */
export const PUSH_PAYLOAD_VERSION = 1;

/** Devices one person may have notifications on; turning on another forgets the one turned on longest ago. */
export const PUSH_MAX_DEVICES = 20;

/** A notification carries at most this many option buttons (Chrome shows two). */
export const NOTIFICATION_ACTIONS_MAX = 2;

/** The one cache the worker owns: the offline page and the static files it needs. Bump the suffix to drop an old one. */
export const OFFLINE_CACHE = "phean-offline-v1";

/** Every call the worker makes to Phean says who it is, which also forces a CORS preflight no other origin passes. */
export const PUSH_CLIENT_HEADERS = { "Content-Type": "application/json", "Phean-Client": "web" } as const;

/** A notification shows the colourful app icon. */
const NOTIFICATION_ICON = routes.appIcon(APP_ICON_SIZES[0]);

export interface RequestPush {
  type: "request";
  private: false;
  slug: string;
  workspaceName: string;
  requestId: string;
  taskId: string;
  agentName: string;
  question: string;
  /** At most the first two options, and none when the device may not answer from notifications. */
  options: string[];
  answerable: boolean;
}

/** What a device marked private gets: where, never what. */
export interface PrivatePush {
  type: "request";
  private: true;
  slug: string;
  workspaceName: string;
  requestId: string;
  taskId: string;
}

/** Why a request's notification is replaced; null from a server older than the reason. */
export type ResolvedReason = "answered" | "replaced" | "closed";

const RESOLVED_REASONS: readonly string[] = ["answered", "replaced", "closed"] satisfies ResolvedReason[];

/** The request was answered or closed elsewhere; the notification with its tag is replaced. */
export interface ResolvedPush {
  type: "resolved";
  slug: string;
  requestId: string;
  reason: ResolvedReason | null;
  /** The person who answered. */
  by: string | null;
  /** Who closed it, when it was not answered. */
  closedBy: string | null;
  /** The workspace it was in; null from a server older than the field. */
  workspaceName: string | null;
  /** The request's question; null on a private device, or from an older server. */
  question: string | null;
}

export type PushPayload = RequestPush | PrivatePush | ResolvedPush;

/** What a notification remembers for its click and its buttons: ids, and the request it showed. */
export interface NotificationData {
  slug: string;
  requestId: string;
  taskId: string | null;
  /** The request as it was shown, so Undo can show it again and a "resolved" can keep its question. */
  request: RequestPush | null;
}

export interface NotificationAction {
  action: string;
  title: string;
}

/** The arguments of `registration.showNotification`. */
export interface NotificationSpec {
  title: string;
  options: {
    tag: string;
    body?: string;
    icon: string;
    badge: string;
    data: NotificationData | null;
    actions: NotificationAction[];
    /** A replacement for the same tag does not buzz again. */
    silent?: boolean;
    renotify?: boolean;
  };
}

/** A POST the worker makes to Phean: a same-origin path and its JSON body. */
export interface PushCall {
  path: string;
  body: Record<string, string | number>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * A slug is placed into a path, so it must be one plain path segment. The server sends only valid
 * slugs; this guards the address, not the slug rule (that is `WORKSPACE_SLUG_PATTERN`'s job).
 */
function isPathSegment(value: unknown): value is string {
  return isText(value) && value !== "." && value !== ".." && encodeURIComponent(value) === value;
}

const isRequestId = (value: unknown): value is string => isLinkableId(value) && value.startsWith("q_");
const isTaskId = (value: unknown): value is string => isLinkableId(value) && value.startsWith("t_");

/** The payload a push carried, or null for anything this worker does not understand. */
export function parsePushPayload(text: string | null | undefined): PushPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? "");
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== PUSH_PAYLOAD_VERSION || !isPathSegment(raw.slug) || !isRequestId(raw.requestId)) return null;
  const { slug, requestId } = raw;
  if (raw.type === "resolved") {
    const reason = typeof raw.reason === "string" && RESOLVED_REASONS.includes(raw.reason) ? (raw.reason as ResolvedReason) : null;
    const text = (value: unknown) => (isText(value) ? value : null);
    return { type: "resolved", slug, requestId, reason, by: text(raw.by), closedBy: text(raw.closedBy), workspaceName: text(raw.workspaceName), question: text(raw.question) };
  }
  if (raw.type !== "request" || !isTaskId(raw.taskId) || !isText(raw.workspaceName)) return null;
  const base = { type: "request" as const, slug, requestId, taskId: raw.taskId, workspaceName: raw.workspaceName };
  if (raw.private === true) return { ...base, private: true };
  if (!isText(raw.agentName) || !isText(raw.question)) return null;
  const options = Array.isArray(raw.options) ? raw.options.filter(isText).slice(0, NOTIFICATION_ACTIONS_MAX) : [];
  return { ...base, private: false, agentName: raw.agentName, question: raw.question, options, answerable: raw.answerable === true };
}

/** The notification's data back from the platform, checked again: a click acts only on ids it can trust. */
export function readNotificationData(raw: unknown): NotificationData | null {
  if (!isRecord(raw) || !isPathSegment(raw.slug) || !isRequestId(raw.requestId)) return null;
  const request = isRecord(raw.request) ? parsePushPayload(JSON.stringify({ ...raw.request, v: PUSH_PAYLOAD_VERSION })) : null;
  return {
    slug: raw.slug,
    requestId: raw.requestId,
    taskId: isTaskId(raw.taskId) ? raw.taskId : null,
    request: request?.type === "request" && !request.private && request.slug === raw.slug && request.requestId === raw.requestId ? request : null,
  };
}

/**
 * A notification's spec. The status bar's small icon (`badge`) is a white silhouette, since Android
 * keeps only its alpha: the boulder on its slope while a request waits, a check once it is settled
 * (answered, sent from here, or closed).
 */
function spec(
  tag: string,
  title: string,
  data: NotificationData | null,
  { badge = "request", ...extra }: Partial<Omit<NotificationSpec["options"], "badge">> & { badge?: NotificationBadge } = {},
): NotificationSpec {
  return { title, options: { tag, icon: NOTIFICATION_ICON, badge: routes.notificationBadge(badge), data, actions: [], ...extra } };
}

/** An option button's action name, and back. */
export const optionAction = (index: number) => `option-${index}`;
export const UNDO_ACTION = "undo";

export function optionIndexOf(action: string | null | undefined): number | null {
  const match = /^option-(\d)$/.exec(action ?? "");
  const index = match ? Number(match[1]) : NaN;
  return index < NOTIFICATION_ACTIONS_MAX ? index : null;
}

/** The title of a request's notification, plainly an agent's words: "Scout asks · Acme". */
export const requestTitle = (push: Pick<RequestPush, "agentName" | "workspaceName">) => `${push.agentName} asks · ${push.workspaceName}`;

/** A request as a notification: its question, who asks and where, and its option buttons when the device may answer. */
export function requestNotification(push: RequestPush): NotificationSpec {
  const data: NotificationData = { slug: push.slug, requestId: push.requestId, taskId: push.taskId, request: push };
  const actions = push.answerable ? push.options.map((title, index) => ({ action: optionAction(index), title })) : [];
  return spec(push.requestId, requestTitle(push), data, { body: push.question, actions });
}

/** A request's question as the subject of a sentence, cut to fit a notification line. */
const SUBJECT_CHARS = 80;
export function quotedSubject(question: string): string {
  const cut = question.length > SUBJECT_CHARS ? `${question.slice(0, SUBJECT_CHARS - 1).trimEnd()}…` : question;
  return `“${cut}”`;
}

/** What happened to a request, as a title. Only a person ever "answered" it. */
function resolvedWhat(push: ResolvedPush): string {
  if (push.reason === "replaced") return "Replaced by a new question";
  if (push.reason === "closed") return push.closedBy ? `Closed by ${push.closedBy}` : "Closed";
  return push.by ? `Answered by ${push.by}` : "Answered elsewhere";
}

/** The same, as a sentence about a decision in a workspace, for when no question can be shown (a private device). */
function resolvedSentence(push: ResolvedPush, workspaceName: string): string {
  if (push.reason === "replaced") return `A decision in ${workspaceName} was replaced by a new question`;
  if (push.reason === "closed") return `A decision in ${workspaceName} was closed`;
  return `A decision in ${workspaceName} was answered`;
}

/**
 * What replaced a request's notification says: what happened, where, and to what. The question
 * comes from the payload, or else from the notification it replaces; with neither (a private
 * device), the workspace is the subject: "A decision in Acme was closed".
 */
function resolvedNotification(push: ResolvedPush, previous: NotificationData | null): Pick<NotificationSpec, "title"> & { body?: string } {
  const question = push.question ?? previous?.request?.question ?? null;
  const workspaceName = push.workspaceName ?? previous?.request?.workspaceName ?? null;
  if (question) return { title: workspaceName ? `${resolvedWhat(push)} · ${workspaceName}` : resolvedWhat(push), body: question };
  if (workspaceName) return { title: resolvedSentence(push, workspaceName) };
  return { title: resolvedWhat(push) };
}

/**
 * What a push shows. Chrome requires every push to show something, so a payload this worker cannot
 * read still says that something changed. `previous` is the data of the notification a
 * "resolved" replaces, which keeps its question in view.
 */
export function notificationFor(push: PushPayload | null, previous: NotificationData | null = null): NotificationSpec {
  if (!push) return spec("phean", "Phean", null, { body: "Something changed in Phean." });
  if (push.type === "resolved") {
    const data: NotificationData = { slug: push.slug, requestId: push.requestId, taskId: previous?.taskId ?? null, request: null };
    const { title, body } = resolvedNotification(push, previous);
    return spec(push.requestId, title, data, { body, silent: true, badge: "resolved" });
  }
  if (push.private) {
    return spec(push.requestId, `A decision is waiting in ${push.workspaceName}`, { slug: push.slug, requestId: push.requestId, taskId: push.taskId, request: null });
  }
  return requestNotification(push);
}

/** Where a click goes: the request on its Decisions page, built from the ids and checked to be on this origin. */
export function notificationUrl(data: NotificationData | null, origin: string): string {
  const fallback = new URL(routes.workspaces(), origin).href;
  if (!data || !isPathSegment(data.slug) || !isRequestId(data.requestId)) return fallback;
  const url = new URL(routes.request(data.slug, data.requestId), origin);
  return url.origin === origin && url.pathname.startsWith(`/w/${data.slug}/`) ? url.href : fallback;
}

/** True when a window's address is on this origin, the only kind a click may focus. */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The answer an option button posts: the option's index, never its label, which the server reads
 * from the request, and this device's push endpoint when it has one, so only the person's other
 * devices have their notification replaced.
 */
export function answerCall(data: NotificationData | null, option: number, endpoint?: string | null): PushCall | null {
  if (!data?.taskId || !data.request || option < 0 || option >= data.request.options.length) return null;
  return { path: routes.pushAnswer(data.slug), body: { taskId: data.taskId, requestId: data.requestId, option, ...(endpoint && { endpoint }) } };
}

export function undoCall(data: NotificationData | null, endpoint?: string | null): PushCall | null {
  if (!data?.taskId) return null;
  return { path: routes.pushUndo(data.slug), body: { taskId: data.taskId, requestId: data.requestId, ...(endpoint && { endpoint }) } };
}


/** The server's word on an answer (CONTRACTS.md): the label it recorded, the task, and the agent that gets it. */
export interface AnswerResult {
  answer: string;
  taskTitle: string;
  agentName: string;
}

export function parseAnswerResult(raw: unknown): AnswerResult | null {
  if (!isRecord(raw) || !isText(raw.answer) || !isText(raw.agentName)) return null;
  return { answer: raw.answer, agentName: raw.agentName, taskTitle: isText(raw.taskTitle) ? raw.taskTitle : "" };
}

/** After an answer: what was sent and to whom, with Undo. */
export function answeredNotification(data: NotificationData, result: AnswerResult): NotificationSpec {
  return spec(data.requestId, `Sent “${result.answer}” to ${result.agentName}`, data, {
    badge: "resolved",
    body: data.request?.question || result.taskTitle || undefined,
    actions: [{ action: UNDO_ACTION, title: "Undo" }],
    silent: true,
  });
}

/** An answer that did not land: answered already (409), signed out (401), or anything else. A click opens the request. */
export function answerFailedNotification(data: NotificationData, status: number, message?: string): NotificationSpec {
  const forClick: NotificationData = { ...data, request: null };
  const subject = data.request ? quotedSubject(data.request.question) : null;
  if (status === 409) {
    const body = message || (subject ? `${subject} was answered or replaced before your answer arrived.` : "This request was answered or replaced before your answer arrived.");
    return spec(data.requestId, "Already answered", forClick, { body, silent: true, badge: "resolved" });
  }
  if (status === 401) {
    return spec(data.requestId, "Sign in to answer", forClick, { body: subject ? `Open Phean on this device to sign in again, then answer ${subject}.` : "Open Phean on this device to sign in again.", silent: true });
  }
  return spec(data.requestId, "Your answer was not sent", forClick, { body: subject ? `Open ${subject} to answer it in Phean.` : "Open the request to answer it in Phean.", silent: true });
}

/** After Undo: the request again, so another option can be picked. */
export function undoneNotification(data: NotificationData): NotificationSpec {
  if (data.request) {
    const again = requestNotification(data.request);
    return { ...again, options: { ...again.options, silent: true } };
  }
  return spec(data.requestId, "Answer taken back", { ...data, request: null }, { body: "Open the request to answer it again.", silent: true });
}

/** Undo refused: the agent already collected the answer (409), or the call failed. */
export function undoFailedNotification(data: NotificationData, status: number): NotificationSpec {
  const agent = data.request?.agentName ?? "The agent";
  const subject = data.request ? quotedSubject(data.request.question) : null;
  const forClick: NotificationData = { ...data, request: null };
  if (status === 409) return spec(data.requestId, "Too late to undo", forClick, { body: subject ? `${agent} already has your answer to ${subject}.` : `${agent} already has the answer.`, silent: true });
  return spec(data.requestId, "Undo did not go through", forClick, { body: subject ? `Open ${subject} to change your answer in Phean.` : "Open the request to change your answer in Phean.", silent: true });
}

/** True for the requests the worker handles: a page load (a GET navigation). Everything else passes straight to the network. */
export function isPageNavigation(request: { mode: string; method: string }): boolean {
  return request.mode === "navigate" && request.method === "GET";
}

/**
 * The offline page's own static files, read from its HTML: its stylesheets and preloaded fonts,
 * which Next serves under `/_next/static/` with hashed names. Nothing else is ever cached.
 */
export function offlineAssets(html: string): string[] {
  const assets = new Set<string>();
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    const href = /\bhref="(\/_next\/static\/[^"?#]+\.(?:css|woff2))"/.exec(tag)?.[1];
    if (href && !href.includes("..")) assets.add(href);
  }
  return [...assets];
}

/** True for the only paths the worker's cache may hold. */
export function isOfflineAsset(path: string): boolean {
  return path === routes.offline() || (/^\/_next\/static\/[^?#]+\.(?:css|woff2)$/.test(path) && !path.includes(".."));
}
