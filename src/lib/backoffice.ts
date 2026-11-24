/**
 * The backoffice's pure maths and vocabulary: trailing windows, medians, changes, the funnel, the
 * retention grid, health flags, client families and CSV. Shared by the services (which feed it rows)
 * and the pages (which lay it out). Client-safe; see docs/backoffice/PLAN.md for the definitions.
 */
import { addDays, DAY_MS, dayOf, daysBetween, isoDate } from "./dates";
import type { Tone } from "./domain";

/** Days in one window: the overview compares trailing weeks, never calendar weeks, so every window is whole. */
export const WINDOW_DAYS = 7;
/** Windows the trend charts draw, oldest first. */
export const TREND_WINDOWS = 12;
/** Days the usage and agent reports look back over. */
export const REPORT_DAYS = 28;
/** Rows per page of the Workspaces table and the audit log. */
export const BACKOFFICE_PAGE_SIZE = 25;
/** The most rows a CSV export holds. */
export const EXPORT_LIMIT = 5000;
/** How long a "Show content" stays open for the admin who asked, in minutes. */
export const CONTENT_GRANT_MINUTES = 30;
/** The shortest reason a "Show content" accepts. */
export const CONTENT_REASON_MIN = 10;
export const CONTENT_REASON_MAX = 500;

/** A run of whole UTC days, `from` and `to` included, as YYYY-MM-DD. */
export interface DayWindow {
  from: string;
  to: string;
}

/** `count` trailing windows of `days` days, back to back, the last ending on `today`; oldest first. */
export function trailingWindows(today: string, count: number, days = WINDOW_DAYS): DayWindow[] {
  const end = dayOf(today);
  return Array.from({ length: count }, (_, index) => {
    const back = count - 1 - index;
    const to = addDays(end, -back * days);
    return { from: isoDate(addDays(to, -(days - 1))), to: isoDate(to) };
  });
}

/** The window a day falls in, or -1. */
export function windowIndexOf(day: string, windows: readonly DayWindow[]): number {
  return windows.findIndex((window) => day >= window.from && day <= window.to);
}

/** Sums `{ day, value }` rows into the windows they fall in; days outside every window are ignored. */
export function sumByWindow(rows: readonly { day: string; value: number }[], windows: readonly DayWindow[]): number[] {
  const sums = windows.map(() => 0);
  for (const row of rows) {
    const index = windowIndexOf(row.day, windows);
    if (index >= 0) sums[index]! += row.value;
  }
  return sums;
}

/** Counts the distinct keys seen in each window, from `{ day, key }` rows. */
export function distinctByWindow(rows: readonly { day: string; key: string }[], windows: readonly DayWindow[]): number[] {
  const sets = windows.map(() => new Set<string>());
  for (const row of rows) {
    const index = windowIndexOf(row.day, windows);
    if (index >= 0) sets[index]!.add(row.key);
  }
  return sets.map((set) => set.size);
}

/** The median, or null for no values. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The change from `previous` to `current` as a fraction, or null when there is nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/** "+12% on the 7 days before", "No change on …", "New: none the 7 days before". */
export function describeChange(current: number, previous: number): { text: string; tone?: Tone } {
  const fraction = change(current, previous);
  if (fraction === null) return { text: current === 0 ? "None either week" : "None the 7 days before" };
  const pct = Math.round(fraction * 100);
  if (pct === 0) return { text: "No change on the 7 days before" };
  return { text: `${pct > 0 ? "+" : "−"}${Math.abs(pct)}% on the 7 days before`, tone: pct > 0 ? "success" : "warning" };
}

/** Each value as a fraction of the largest, for bar heights; all zeros when there is nothing. */
export function barFractions(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((value) => (max > 0 ? value / max : 0));
}

/** A share, as a fraction; zero when the whole is empty. */
export function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

// ---------------------------------------------------------------------------------------------- funnel

export const FUNNEL_STEPS = [
  { key: "signed_up", label: "Signed up" },
  { key: "workspace", label: "Created a workspace" },
  { key: "agent", label: "Connected an agent" },
  { key: "asked", label: "First decision asked" },
  { key: "answered", label: "First decision answered" },
  { key: "week2", label: "Active in week 2" },
  { key: "week4", label: "Active in week 4" },
] as const;
export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]["key"];

/** One person's way through the funnel: when they reached each timed step (ms), and their later activity. */
export interface FunnelPerson {
  signedUpAt: number;
  /** Their signup's UTC day, YYYY-MM-DD: weeks after signup are counted in whole days from it. */
  signupDay: string;
  workspaceAt: number | null;
  agentAt: number | null;
  askedAt: number | null;
  answeredAt: number | null;
  /** Days after signup on which they acted (0 = the signup day). */
  activeDays: readonly number[];
}

export interface FunnelStep {
  key: FunnelStepKey;
  label: string;
  count: number;
  /** Who could have reached it: everyone, or only those whose week has come. */
  eligible: number;
  /** From the step before, among those eligible for this one. */
  fromPrevious: number;
  /** From signup, among those eligible. */
  fromStart: number;
  /** Median ms from the step before, over those who reached both; null for the fixed weeks. */
  medianFromPrevious: number | null;
  /** How many durations that median is over. */
  medianOver: number;
}

/** Whether a person acted on any day in `[from, to]` after signup. */
const activeBetween = (person: FunnelPerson, from: number, to: number) => person.activeDays.some((day) => day >= from && day <= to);

/**
 * The activation funnel. Steps are ordered: a step counts only people who reached every step before
 * it, so each rate is a true conversion. Weeks 2 and 4 count only people whose week is over by
 * `today` (a UTC day), counted in whole days as their activity is, so near midnight nobody is left out.
 */
export function funnel(people: readonly FunnelPerson[], today: string): FunnelStep[] {
  const timed: { key: FunnelStepKey; at: (person: FunnelPerson) => number | null }[] = [
    { key: "signed_up", at: (person) => person.signedUpAt },
    { key: "workspace", at: (person) => person.workspaceAt },
    { key: "agent", at: (person) => person.agentAt },
    { key: "asked", at: (person) => person.askedAt },
    { key: "answered", at: (person) => person.answeredAt },
  ];
  const steps: FunnelStep[] = [];
  let reached = [...people];
  let previous: ((person: FunnelPerson) => number | null) | null = null;
  for (const step of timed) {
    const before = reached;
    reached = reached.filter((person) => step.at(person) !== null);
    const durations = previous ? reached.map((person) => Math.max(0, step.at(person)! - previous!(person)!)) : [];
    steps.push({
      key: step.key,
      label: FUNNEL_STEPS.find((candidate) => candidate.key === step.key)!.label,
      count: reached.length,
      eligible: people.length,
      fromPrevious: share(reached.length, before.length),
      fromStart: share(reached.length, people.length),
      medianFromPrevious: previous ? median(durations) : null,
      medianOver: durations.length,
    });
    previous = step.at;
  }
  for (const [key, from, to] of [
    ["week2", 7, 13],
    ["week4", 21, 27],
  ] as const) {
    const eligible = people.filter((person) => daysBetween(dayOf(person.signupDay), dayOf(today)) > to);
    const before = reached.filter((person) => eligible.includes(person));
    const after = before.filter((person) => activeBetween(person, from, to));
    steps.push({
      key,
      label: FUNNEL_STEPS.find((candidate) => candidate.key === key)!.label,
      count: after.length,
      eligible: eligible.length,
      fromPrevious: share(after.length, before.length),
      fromStart: share(after.length, eligible.length),
      medianFromPrevious: null,
      medianOver: 0,
    });
    reached = after;
  }
  return steps;
}

// ------------------------------------------------------------------------------------------- retention

export interface RetentionRow {
  /** The signup window, as its days. */
  window: DayWindow;
  size: number;
  /** Share active in week 0, 1, …; null where that week is not over for everyone in the cohort. */
  cells: (number | null)[];
}

/**
 * The signup-cohort retention grid. Cohorts are the trailing windows; a person's week k is days
 * 7k to 7k+6 after their signup day. A cell is filled only when week k is over for the cohort's last
 * signup day, so a half-finished week never reads as churn.
 */
export function retentionGrid(
  people: readonly { signupDay: string; activeDays: readonly string[] }[],
  windows: readonly DayWindow[],
  today: string,
): RetentionRow[] {
  const weeks = windows.length;
  return windows.map((window) => {
    const cohort = people.filter((person) => person.signupDay >= window.from && person.signupDay <= window.to);
    const lastSignup = dayOf(window.to);
    const cells = Array.from({ length: weeks }, (_, week) => {
      const weekEnd = isoDate(addDays(lastSignup, week * WINDOW_DAYS + WINDOW_DAYS - 1));
      if (weekEnd >= today || cohort.length === 0) return null;
      const active = cohort.filter((person) => {
        const start = dayOf(person.signupDay);
        const from = isoDate(addDays(start, week * WINDOW_DAYS));
        const to = isoDate(addDays(start, week * WINDOW_DAYS + WINDOW_DAYS - 1));
        return person.activeDays.some((day) => day >= from && day <= to);
      });
      return active.length / cohort.length;
    });
    return { window, size: cohort.length, cells };
  });
}

/** The wash a retention cell takes, 0 (none) to 4 (strongest), in fifths. */
export function retentionStep(fraction: number): 0 | 1 | 2 | 3 | 4 {
  if (fraction <= 0) return 0;
  return Math.min(4, Math.ceil(fraction * 4)) as 1 | 2 | 3 | 4;
}

// ---------------------------------------------------------------------------------------------- health

export const HEALTH_FLAGS = ["dormant", "stuck_decisions", "failing_webhooks"] as const;
export type HealthFlag = (typeof HEALTH_FLAGS)[number];

export const HEALTH_META: Record<HealthFlag, { label: string; tone: Tone; description: string }> = {
  dormant: { label: "Dormant", tone: "neutral", description: "No activity in 14 days" },
  stuck_decisions: { label: "Decisions stuck", tone: "warning", description: "A request open for more than 3 days" },
  failing_webhooks: { label: "Webhooks failing", tone: "danger", description: "A webhook disabled or failing 3 times in a row" },
};

export const DORMANT_DAYS = 14;
export const STUCK_DECISION_DAYS = 3;
export const FAILING_WEBHOOK_STREAK = 3;

export interface HealthInput {
  createdAt: number;
  lastActivityAt: number | null;
  oldestOpenRequestAt: number | null;
  webhooksDisabled: number;
  maxWebhookFailures: number;
}

/** What needs an operator's eye in one workspace, by the thresholds above. */
export function healthFlags(row: HealthInput, now: number): HealthFlag[] {
  const flags: HealthFlag[] = [];
  const dormantSince = now - DORMANT_DAYS * DAY_MS;
  if (row.createdAt < dormantSince && (row.lastActivityAt === null || row.lastActivityAt < dormantSince)) flags.push("dormant");
  if (row.oldestOpenRequestAt !== null && row.oldestOpenRequestAt < now - STUCK_DECISION_DAYS * DAY_MS) flags.push("stuck_decisions");
  if (row.webhooksDisabled > 0 || row.maxWebhookFailures >= FAILING_WEBHOOK_STREAK) flags.push("failing_webhooks");
  return flags;
}

// --------------------------------------------------------------------------------------------- clients

/** The MCP clients Phean's people use, named the way their makers do. */
export const CLIENT_FAMILIES = ["Claude Code", "Claude", "Cursor", "VS Code", "Windsurf", "ChatGPT", "Codex", "Zed", "Other OAuth client", "Fixed key", "Shared key"] as const;
export type ClientFamily = (typeof CLIENT_FAMILIES)[number];

const FAMILY_PATTERNS: [RegExp, ClientFamily][] = [
  [/claude[\s-]*code/i, "Claude Code"],
  [/claude/i, "Claude"],
  [/cursor/i, "Cursor"],
  [/vs\s*code|visual studio code|vscode|copilot/i, "VS Code"],
  [/windsurf|codeium/i, "Windsurf"],
  [/codex/i, "Codex"],
  [/chatgpt|openai/i, "ChatGPT"],
  [/\bzed\b/i, "Zed"],
];

/**
 * Which client an agent connects with: its OAuth client's name, matched to a known family, or how it
 * holds its credential when it has no client (a fixed key, or its parent's key as a named sub-agent).
 */
export function clientFamily(agent: { authKind: string; clientName: string | null; sharesParentKey: boolean }): ClientFamily {
  if (agent.sharesParentKey) return "Shared key";
  if (agent.authKind === "key") return "Fixed key";
  const name = agent.clientName ?? "";
  return FAMILY_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? "Other OAuth client";
}

// --------------------------------------------------------------------------------------------- adoption

/** Product features and the actions that show a workspace used them. */
export const ADOPTION_FEATURES = [
  { key: "decisions", label: "Decisions", actions: ["task.input_requested"] },
  { key: "answers", label: "Answers", actions: ["task.input_answered"] },
  { key: "handoffs", label: "Handoffs", actions: ["task.handed_off"] },
  { key: "goals", label: "Goals", actions: ["goal.approved", "goal.updated", "goal.achieved"] },
  { key: "pipelines", label: "Pipelines", actions: ["pipeline.run_started"] },
  { key: "documents", label: "Documents", actions: ["document.attached", "document.updated"] },
  { key: "memory", label: "Memory", actions: ["memory.saved", "memory.updated"] },
  { key: "webhooks", label: "Webhooks", actions: ["webhook.registered"] },
  { key: "sessions", label: "Linked sessions", actions: ["task.session_linked"] },
] as const;
export type AdoptionFeature = (typeof ADOPTION_FEATURES)[number]["key"];

// ----------------------------------------------------------------------------------------------- tables

export const WORKSPACE_SORTS = ["created", "name", "members", "agents", "open_tasks", "open_decisions", "last_activity"] as const;
export type WorkspaceSort = (typeof WORKSPACE_SORTS)[number];
export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const WORKSPACE_SORT_LABELS: Record<WorkspaceSort, string> = {
  created: "Created",
  name: "Name",
  members: "Members",
  agents: "Agents",
  open_tasks: "Open tasks",
  open_decisions: "Open decisions",
  last_activity: "Last activity",
};

/** The direction a column sorts in when first chosen: names A to Z, figures and dates largest first. */
export function defaultDirection(sort: WorkspaceSort): SortDirection {
  return sort === "name" ? "asc" : "desc";
}

/**
 * Rows as CSV (RFC 4180). A cell a spreadsheet would run as a formula (starting `=`, `+`, `-`, `@`,
 * a tab or a carriage return) is prefixed with `'`, so an export never executes what a customer typed.
 */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** "0 B", "12 KB", "3.4 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** A window as "18–24 Nov", or "28 Oct–3 Nov" across a month. */
export function windowLabel(window: DayWindow): string {
  const from = dayOf(window.from);
  const to = dayOf(window.to);
  const month = (date: Date) => date.toLocaleString("en", { month: "short", timeZone: "UTC" });
  return from.getUTCMonth() === to.getUTCMonth()
    ? `${from.getUTCDate()}–${to.getUTCDate()} ${month(to)}`
    : `${from.getUTCDate()} ${month(from)}–${to.getUTCDate()} ${month(to)}`;
}

/**
 * Whether two-factor is demanded of admins: always on a Vercel deployment (production and previews
 * alike, `VERCEL_ENV` set), and on by default elsewhere; only a machine with no `VERCEL_ENV` (local
 * development, the UI tests) may turn it off with `PHEAN_ADMIN_REQUIRE_2FA=0`.
 */
export function twoFactorRequired(setting: string | undefined, vercelEnv: string | undefined): boolean {
  if (vercelEnv?.trim()) return true;
  const value = setting?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}

