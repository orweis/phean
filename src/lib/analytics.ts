/**
 * Google Analytics 4, typed (docs/ANALYTICS.md). `EVENTS` is every event Phean sends and the only
 * params each may carry; `track` refuses anything else at compile time and drops it at run time. It
 * does nothing unless gtag was loaded, which happens only after a person accepts analytics.
 *
 * Nothing personal goes in: no emails, names, titles, notes, questions, answers, URLs, search terms,
 * slugs or ids. People and workspaces are a salted hash computed on the server (`server/analytics.ts`).
 * Client-safe: no imports from `src/server`.
 */

import { redactLocation, redactReferrer, type Surface } from "./analytics-paths";

export { redactLocation, redactReferrer, SURFACES, type Surface } from "./analytics-paths";

/** The visitor's analytics choice, kept for a year. Unset means not asked yet, which counts as no. */
export const CONSENT_COOKIE = "phean-consent";
export const CONSENT_CHOICES = ["granted", "denied"] as const;
export type ConsentChoice = (typeof CONSENT_CHOICES)[number];
const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

export function parseConsent(value: unknown): ConsentChoice | null {
  return value === "granted" || value === "denied" ? value : null;
}

/** A `document.cookie` assignment that keeps the choice for a year on this origin. */
export function consentCookie(choice: ConsentChoice, secure: boolean): string {
  return [`${CONSENT_COOKIE}=${choice}`, "Path=/", `Max-Age=${CONSENT_MAX_AGE}`, "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}

// ---------------------------------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------------------------------

type ParamType = "string" | "number" | "boolean" | readonly string[];

interface EventSpec {
  params: Readonly<Record<string, ParamType>>;
  /** Marked as a key event in GA. */
  key?: boolean;
  /** `also`: the server sends a copy over the Measurement Protocol; `only`: only the server sends it. */
  server?: "also" | "only";
}

const BOOL = "boolean" as const;
const NUM = "number" as const;

const LAYOUTS = ["board", "table", "calendar", "map"] as const;
const LEVELS = ["read", "write", "admin"] as const;
const ROLES = ["owner", "admin", "member"] as const;
const METHODS = ["password", "github", "google"] as const;
const TRIGGERS = ["manual", "agent", "schedule", "event", "webhook"] as const;
const HAND_OFF_TO = ["agent", "person", "anyone"] as const;
const DECISION_KINDS = ["decision", "question"] as const;
/** Where a person answered a request: a page, the overview's inbox, a notification, the desktop app, a pipeline's card, or Quick Decisions. */
const ANSWER_VIA = ["page", "inbox", "notification", "desktop", "pipeline_card", "quick"] as const;
/** The MCP clients `client_hint` names; anything else is `other`. */
export const KNOWN_CLIENTS = ["claude_code", "claude_desktop", "claude_ai", "cursor", "vscode", "chatgpt", "windsurf", "codex", "other"] as const;
export const SKILLS = ["phean-decisions", "phean-handoffs", "phean-pipelines", "phean-webhooks", "phean-documents"] as const;
const BUCKET = "string" as const;

export const EVENTS = {
  // Every surface
  page_view: { params: { content_group: "string", page_template: "string", post_slug: "string", doc_slug: "string", doc_section: "string" } },
  consent_change: { params: { analytics: CONSENT_CHOICES } },
  click: { params: { outbound: BOOL, link_domain: "string", link_url: "string" } },

  // Marketing site
  cta_click: { params: { cta_id: "string", location: "string" } },
  section_view: { params: { section_id: "string" } },
  demo_interact: { params: { demo: ["boulder", "handoff_relay"], action: "string" } },
  docs_nav: { params: { target: "string" } },

  // Docs
  docs_copy: { params: { doc_slug: "string", block: ["code", "mcp_url", "install_command", "prompt"], lang: "string" } },
  docs_search: { params: { results_count: NUM } },
  docs_feedback: { params: { doc_slug: "string", helpful: BOOL } },
  skill_install_click: { params: { skill: SKILLS } },
  client_setup_view: { params: { client: ["claude_code", "claude_desktop", "cursor", "vscode", "chatgpt", "other"] } },

  // Auth and onboarding
  sign_up_start: { params: {} },
  sign_up: { params: { method: METHODS }, key: true, server: "also" },
  login: { params: { method: METHODS, two_factor: BOOL } },
  two_factor_challenge: { params: { result: ["shown", "passed", "failed"] } },
  workspace_create: { params: {}, key: true, server: "also" },
  workspace_delete: { params: {} },
  invite_send: { params: { role: ROLES } },
  invite_accept: { params: { role: ROLES } },
  onboarding_step: { params: { step: ["connect_agent_viewed", "mcp_url_copied", "first_task_seen"] } },

  // App: agents
  agent_connect_start: { params: { client_hint: KNOWN_CLIENTS } },
  agent_connect_approve: { params: { level: LEVELS, lifetime_days: NUM, reconnect: BOOL, took_over_work: BOOL, client_hint: KNOWN_CLIENTS }, key: true, server: "also" },
  agent_connect_deny: { params: {} },
  agent_revoke: { params: { is_subagent: BOOL } },
  agent_key_issue: { params: {} },

  // App: decisions
  decision_view: { params: { pending_count_bucket: BUCKET } },
  decision_answer: {
    params: {
      via: ANSWER_VIA,
      kind: DECISION_KINDS,
      with_options: BOOL,
      multiple: BOOL,
      custom_answer: BOOL,
      is_pipeline: BOOL,
      first_answer: BOOL,
      // Quick Decisions only: how the answer was given.
      gesture: ["swipe", "tap", "dock", "composer", "keyboard"],
    },
    // Only for answers no page sees: from a notification or the desktop app.
    server: "also",
  },
  // The key event: a workspace's first answer, sent beside its `decision_answer` (`derivedEvents`).
  first_decision_answer: { params: { via: ANSWER_VIA }, key: true, server: "also" },
  decision_snooze: { params: { gesture: ["swipe", "button", "keyboard"] } },
  decision_undo: { params: {} },
  decision_mark_answered: { params: {} },
  quick_decisions_open: { params: { from: ["button", "phone", "link"] } },
  quick_context_open: { params: { tab: ["context", "files", "links"] } },
  quick_file_open: { params: {} },
  quick_decisions_done: { params: { answered_bucket: BUCKET } },
  quick_snoozed_rest: { params: { snoozed_bucket: BUCKET } },
  quick_snoozed_show: { params: {} },

  // App: tasks
  task_create_manual: { params: { as: ["task", "goal"] } },
  task_move: { params: { from_kind: "string", to_kind: "string", via: ["drag", "button", "keyboard"] } },
  task_done: { params: {} },
  task_drop: { params: {} },
  task_undo: { params: {} },
  task_hand_off: { params: { to: HAND_OFF_TO, hand_back: BOOL } },
  task_take: { params: {} },
  task_release: { params: {} },
  task_peek_open: { params: { from: ["board", "table", "calendar", "map", "search", "decisions", "goals", "other"] } },
  task_open_page: { params: {} },
  tasks_layout: { params: { layout: LAYOUTS } },
  filter_apply: { params: { filter: ["goal", "status", "kind", "operator", "stuck"] } },

  // App: search, goals
  search_submit: { params: { has_results: BOOL, used_suggestion: BOOL, from: ["shortcut", "click"] } },
  goal_create: { params: {} },
  goal_decide: { params: { decision: ["approve", "reject", "achieved", "abandon"] } },
  goal_open: { params: {} },

  // App: pipelines
  pipeline_create: {
    params: { kind: "string", template: "string", stops_count: NUM, has_person_stop: BOOL, has_fork: BOOL, has_choice: BOOL, created_by: ["person", "agent"] },
    key: true,
    server: "also",
  },
  pipeline_save_version: { params: { stops_count: NUM } },
  pipeline_tab: { params: { tab: ["map", "runs", "insights", "definition"] } },
  run_start: { params: { trigger: TRIGGERS }, server: "also" },
  run_cancel: { params: {} },
  run_rerun_from: { params: {} },
  run_rename: { params: {} },
  handoff_resend: { params: { stuck: BOOL } },
  run_view: { params: { view: ["compact", "timeline", "activity"] } },
  proposal_decide: { params: { result: ["approve", "reject"] } },
  pipeline_pause: { params: {} },
  pipeline_resume: { params: {} },
  pipeline_archive: { params: {} },
  trigger_edit: { params: { trigger_type: TRIGGERS } },

  // App: documents, memory, navigation
  document_open: { params: { format: ["markdown", "html", "file"] } },
  memory_search: { params: { has_results: BOOL } },
  tab_open: { params: { tab: "string" } },
  copy_link: { params: { kind: "string" } },
  keyboard_shortcut: { params: { shortcut: "string" } },
  resume_session_click: { params: { kind: ["link", "popover"] } },

  // App: settings and account
  theme_change: { params: { theme: "string" } },
  appearance_change: { params: { appearance: ["light", "dark", "system"] } },
  push_enable: { params: {} },
  push_disable: { params: {} },
  two_factor_enable: { params: {} },
  account_link: { params: { provider: ["github", "google"] } },
  workflow_save: { params: { stages_count: NUM } },
  webhook_view: { params: {} },

  // Server only (Measurement Protocol): what agents do over MCP, with no page
  agent_first_call: { params: { client_hint: KNOWN_CLIENTS, level: LEVELS }, server: "only" },
  agent_active_day: { params: { tools_used_bucket: BUCKET }, server: "only" },
  decision_ask: { params: { kind: DECISION_KINDS, with_options: BOOL, is_pipeline: BOOL }, server: "only" },
  task_capture: { params: { count_bucket: BUCKET, source: "string" }, server: "only" },
  hand_off: { params: { to: HAND_OFF_TO }, server: "only" },
  run_end: { params: { outcome: ["done", "failed", "cancelled"], duration_bucket: BUCKET }, server: "only" },
} as const satisfies Record<string, EventSpec>;

export type EventName = keyof typeof EVENTS;
/** Events a page may send: everything but the server's own. */
export type ClientEventName = { [N in EventName]: (typeof EVENTS)[N] extends { server: "only" } ? never : N }[EventName];

type ValueOf<T> = T extends "string" ? string : T extends "number" ? number : T extends "boolean" ? boolean : T extends readonly (infer U)[] ? U : never;
export type EventParams<N extends EventName> = { -readonly [K in keyof (typeof EVENTS)[N]["params"]]?: ValueOf<(typeof EVENTS)[N]["params"][K]> };

/** Params every event carries (`commonParams`), and the user-scoped properties. */
export const COMMON_PARAMS = {
  surface: ["marketing", "docs", "blog", "auth", "app", "oauth"],
  app_shell: ["web", "desktop", "android"],
  theme: "string",
  appearance: ["light", "dark", "system"],
  signed_in: BOOL,
  workspace_hash: "string",
  role: ROLES,
} as const satisfies Record<string, ParamType>;
export const USER_PROPERTIES = {
  plan: "string",
  signup_method: METHODS,
  workspace_count_bucket: ["1", "2-3", "4+"],
} as const satisfies Record<string, ParamType>;

/** The longest string GA is sent; anything longer is not an enum or a slug and is dropped. */
const MAX_STRING = 100;

function allowed(type: ParamType, value: unknown): boolean {
  if (typeof type !== "string") return typeof value === "string" && type.includes(value);
  if (type === "string") return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING;
  return typeof value === type && (type !== "number" || Number.isFinite(value));
}

/** The params of `params` the catalog allows for `name`, in the types it names. GA wants 0/1 for booleans in reports, but takes booleans fine. */
/**
 * The events one event implies, sent beside it with the same side (page or server): GA's own derived
 * events cannot test a parameter, so a key event that is one event's special case is sent by name.
 */
export function derivedEvents(name: EventName, params: Record<string, unknown>): [EventName, Record<string, unknown>][] {
  if (name === "decision_answer" && params.first_answer === true) return [["first_decision_answer", { via: params.via }]];
  return [];
}

export function cleanParams(spec: Readonly<Record<string, ParamType>>, params: Record<string, unknown>): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    const type = spec[key];
    if (type && allowed(type, value)) clean[key] = value as string | number | boolean;
  }
  return clean;
}

/** A count as the bucket GA keeps, never the exact figure: `0`, `1`, `2-3`, `4-9`, `10-24`, `25+`. */
export function countBucket(count: number): string {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 3) return "2-3";
  if (count <= 9) return "4-9";
  if (count <= 24) return "10-24";
  return "25+";
}

/** How many workspaces a person is in, as the user property's buckets. */
export function workspaceCountBucket(count: number): "1" | "2-3" | "4+" {
  return count <= 1 ? "1" : count <= 3 ? "2-3" : "4+";
}

/** An MCP client's name (as its OAuth registration gives it) as one of `KNOWN_CLIENTS`. */
export function clientHint(name: string | null | undefined): (typeof KNOWN_CLIENTS)[number] {
  const lower = (name ?? "").toLowerCase();
  if (lower.includes("claude code") || lower.includes("claude-code")) return "claude_code";
  if (lower.includes("claude desktop")) return "claude_desktop";
  if (lower.includes("claude")) return "claude_ai";
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("visual studio code") || lower.includes("vscode") || lower.includes("vs code") || lower.includes("copilot")) return "vscode";
  if (lower.includes("chatgpt") || lower.includes("openai")) return "chatgpt";
  if (lower.includes("windsurf") || lower.includes("codeium")) return "windsurf";
  if (lower.includes("codex")) return "codex";
  return "other";
}

/** The registrable part of a host (`acme.slack.com` → `slack.com`), so an app link's customer-specific subdomain is never sent. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2 || /^\d+$/.test(labels.at(-1)!)) return labels.length > 2 ? "ip" : labels.join(".");
  // Two-letter country codes often take a second level (co.uk, com.au).
  const take = labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3 ? 3 : 2;
  return labels.slice(-take).join(".");
}

// ---------------------------------------------------------------------------------------------------
// The browser side
// ---------------------------------------------------------------------------------------------------

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: Gtag;
    dataLayer?: unknown[];
  }
}

/** What the page knows about the viewer, set by `AnalyticsIdentity` on signed-in pages. */
export interface AnalyticsIdentityParams {
  signed_in?: boolean;
  /** The salted hash of the person's id, never the id itself. */
  user_id?: string;
  workspace_hash?: string;
  role?: (typeof ROLES)[number];
  user_properties?: { -readonly [K in keyof typeof USER_PROPERTIES]?: ValueOf<(typeof USER_PROPERTIES)[K]> };
}

const state: {
  consent: ConsentChoice | null;
  /** Whether the loader has said what the visitor chose; until then events wait in `queue`. */
  ready: boolean;
  queue: [string, Record<string, unknown>][];
  signedIn: boolean;
  identity: AnalyticsIdentityParams;
  page: Record<string, string>;
} = {
  consent: null,
  ready: false,
  queue: [],
  signedIn: false,
  identity: {},
  page: {},
};

/** At most this many events wait for the loader on a fresh load; anything older is dropped. */
const MAX_QUEUED = 20;

/**
 * Called by the loader: what the visitor chose, so `track` knows whether it may send. On a fresh load a
 * page's own effects run before the loader's, so their events wait for this; they are sent once gtag
 * is set up (`flushAnalyticsQueue`) if the visitor had already accepted, and dropped otherwise.
 */
export function setAnalyticsConsent(choice: ConsentChoice | null): void {
  state.consent = choice;
  state.ready = true;
  if (choice !== "granted") state.queue = [];
}

/** Sends the events that waited for the loader, now that gtag is set up with the page's redacted location. */
export function flushAnalyticsQueue(): void {
  const waiting = state.queue;
  state.queue = [];
  const send = gtag();
  if (!send) return;
  for (const [name, params] of waiting) {
    try {
      send("event", name, params);
    } catch {
      // Analytics never breaks the page.
    }
  }
}

/** Called by the loader: whether a session cookie was present when the page was served (the public site never reads the session). */
export function setAnalyticsSignedIn(signedIn: boolean): void {
  state.signedIn = signedIn;
}

/** Called by `AnalyticsIdentity`: the hashed workspace and the role on app pages; cleared when they unmount. */
export function setAnalyticsIdentity(identity: AnalyticsIdentityParams): void {
  state.identity = identity;
  applyAnalyticsIdentity();
}

/** Tells gtag who is viewing (the hashed person, their user properties), or that nobody is. */
export function applyAnalyticsIdentity(): void {
  const send = gtag();
  if (!send) return;
  try {
    send("set", { user_id: state.identity.user_id ?? null });
    const properties = cleanParams(USER_PROPERTIES, state.identity.user_properties ?? {});
    if (Object.keys(properties).length) send("set", "user_properties", properties);
  } catch {
    // Analytics never breaks the page.
  }
}

/** Called by `AnalyticsPage`: extra `page_view` params for the page on screen (a doc's slug and section, a post's slug). */
export function setAnalyticsPage(params: Record<string, string>): void {
  state.page = params;
}

export function analyticsPage(): Record<string, string> {
  return state.page;
}

function gtag(): Gtag | undefined {
  if (typeof window === "undefined" || state.consent !== "granted") return undefined;
  return typeof window.gtag === "function" ? window.gtag : undefined;
}

/** Which app the page runs in: the desktop shell, the Android app (an installed, standalone window), or a browser. */
export function appShell(): "web" | "desktop" | "android" {
  if (typeof window === "undefined") return "web";
  if (typeof window.pheanDesktop !== "undefined") return "desktop";
  if (window.matchMedia?.("(display-mode: standalone)").matches || document.referrer.startsWith("android-app://")) return "android";
  return "web";
}

/** The params every event carries, read from the page now. */
export function commonParams(surface: Surface = redactLocation(window.location.pathname).surface): Record<string, string | boolean> {
  const common: Record<string, string | boolean> = { surface, app_shell: appShell(), signed_in: state.identity.signed_in ?? state.signedIn };
  if (surface === "app") {
    const root = document.documentElement;
    if (root.dataset.theme) common.theme = root.dataset.theme;
    if (root.dataset.appearance) common.appearance = root.dataset.appearance;
    if (state.identity.workspace_hash) common.workspace_hash = state.identity.workspace_hash;
    if (state.identity.role) common.role = state.identity.role;
  }
  return common;
}

/**
 * Sends one event with only the params its catalog entry allows, plus the common ones. Does nothing
 * on the server, before consent, or where GA is not loaded (dev, tests, a visitor who declined). On a
 * fresh load, before the loader has read the visitor's choice, the event waits (`flushAnalyticsQueue`).
 */
export function track<N extends ClientEventName>(name: N, ...[params]: keyof EventParams<N> extends never ? [] : [EventParams<N>?]): void {
  if (typeof window === "undefined") return;
  try {
    const given = (params ?? {}) as Record<string, unknown>;
    const clean = cleanParams(EVENTS[name].params, given);
    const common = commonParams();
    const events: [string, Record<string, unknown>][] = [
      [name, { ...common, ...clean }],
      ...derivedEvents(name, clean).map(([derived, extra]): [string, Record<string, unknown>] => [derived, { ...common, ...cleanParams(EVENTS[derived].params, extra) }]),
    ];
    if (!state.ready) {
      for (const event of events) if (state.queue.length < MAX_QUEUED) state.queue.push(event);
      return;
    }
    const send = gtag();
    if (!send) return;
    // How a person signed up stays with them as a user property.
    if (name === "sign_up" && typeof clean.method === "string") send("set", "user_properties", { signup_method: clean.method });
    for (const [event, payload] of events) send("event", event, payload);
  } catch {
    // Analytics never breaks the page.
  }
}

/** The page fields GA reports for the page on screen: the route pattern, never the address or a private title. */
export function pageContext(previousPath: string | null): { page_location: string; page_path: string; page_title: string; page_referrer: string } {
  const { origin, pathname, search } = window.location;
  const location = redactLocation(pathname, search);
  return {
    page_location: `${origin}${location.path}${location.search}`,
    page_path: location.path,
    // A public page's title is public; an app page's names the workspace or a task, so it is the pattern.
    page_title: location.surface === "app" || location.surface === "oauth" || location.surface === "auth" ? location.template : document.title,
    // Always set, even empty, so gtag never falls back to `document.referrer`.
    page_referrer: previousPath ? `${origin}${previousPath}` : (redactReferrer(document.referrer, origin) ?? ""),
  };
}

/**
 * Makes the redacted page fields the ones every later event reports (gtag's own included). Called by
 * the loader as soon as gtag is set up and on every navigation, before any event of the new page.
 */
export function applyPageContext(previousPath: string | null): void {
  const send = gtag();
  if (!send) return;
  try {
    send("set", pageContext(previousPath));
  } catch {
    // Analytics never breaks the page.
  }
}

/** Sends the `page_view` for the page on screen, with the redacted location and title. Called by the loader on navigation. */
export function trackPageView(previousPath: string | null): void {
  const send = gtag();
  if (!send) return;
  try {
    const page = pageContext(previousPath);
    send("set", page);
    const location = redactLocation(window.location.pathname);
    const extra = cleanParams(EVENTS.page_view.params, { content_group: location.surface, page_template: location.template, ...state.page });
    send("event", "page_view", { ...page, ...commonParams(location.surface), ...extra });
  } catch {
    // Analytics never breaks the page.
  }
}
