import { TASK_STATUS_META, TASK_STATUSES } from "./domain";
import { routes } from "./routes";
import { WORKSPACE_PAGES } from "./workspace-pages";

/** What search suggests while a person types, grouped in this order. */
export const SUGGESTION_GROUPS = ["page", "filter", "goal", "task", "document", "memory"] as const;
export type SuggestionGroup = (typeof SUGGESTION_GROUPS)[number];

export const SUGGESTION_GROUP_LABELS: Record<SuggestionGroup, string> = {
  page: "Go to",
  filter: "Show tasks",
  goal: "Goals",
  task: "Tasks",
  document: "Documents",
  memory: "Memory",
};

export interface Suggestion {
  group: SuggestionGroup;
  /** Unique within one list of suggestions. */
  key: string;
  label: string;
  /** A few muted words: a status, a goal, where it came from. */
  detail?: string;
  href: string;
}

/** The most suggestions a group shows, so one busy kind cannot crowd out the rest. */
export const PER_GROUP = 4;

/**
 * How well `text` answers `query`: 3 when it starts with it, 2 when a word in it does, 1 when it
 * contains it anywhere, 0 when not at all. Case and accents are ignored.
 */
export function matchScore(text: string, query: string): number {
  const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const haystack = fold(text);
  const needle = fold(query);
  if (!needle) return 0;
  if (haystack.startsWith(needle)) return 3;
  if (haystack.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(needle))) return 2;
  return haystack.includes(needle) ? 1 : 0;
}

/** The best matches of `items` by `text`, strongest first, ties in their own order. */
export function bestMatches<T>(items: readonly T[], query: string, text: (item: T) => string | readonly string[], limit = PER_GROUP): T[] {
  return items
    .map((item, index) => ({ item, index, score: Math.max(0, ...[text(item)].flat().map((value) => matchScore(value, query))) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

/**
 * Workspace pages whose name, or another word for them, matches. A page found by another word says
 * which ("Tasks · kanban"). Names and words count only from the start of a word, so letters inside
 * one ("find" or "Timeline" for "in") do not offer a page nobody asked for.
 */
export function pageSuggestions(slug: string, query: string): Suggestion[] {
  const synonym = (page: (typeof WORKSPACE_PAGES)[number]) => page.words.find((word) => matchScore(word, query) >= 2);
  const named = WORKSPACE_PAGES.filter((page) => matchScore(page.label, query) >= 2 || synonym(page));
  return bestMatches(named, query, (page) => (synonym(page) ? [page.label, synonym(page)!] : [page.label])).map((page) => ({
    group: "page",
    key: `page:${page.key}`,
    label: page.label,
    detail: matchScore(page.label, query) ? undefined : synonym(page),
    href: page.href(slug),
  }));
}

/** Statuses whose name matches, each as a filter on the Tasks table ("in pro" offers In progress). */
export function statusSuggestions(slug: string, query: string): Suggestion[] {
  return bestMatches(TASK_STATUSES, query, (status) => TASK_STATUS_META[status].label).map((status) => ({
    group: "filter",
    key: `status:${status}`,
    label: `${TASK_STATUS_META[status].label} tasks`,
    detail: "As a table",
    href: routes.tasksByStatus(slug, status),
  }));
}

/** Suggestions in group order, each group cut to `PER_GROUP`. */
export function orderSuggestions(suggestions: readonly Suggestion[]): Suggestion[] {
  return SUGGESTION_GROUPS.flatMap((group) => suggestions.filter((suggestion) => suggestion.group === group).slice(0, PER_GROUP));
}
