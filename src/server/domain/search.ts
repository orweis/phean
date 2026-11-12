import { and, desc, sql } from "drizzle-orm";

import { GOAL_STATUS_META, TASK_STATUS_META } from "@/lib/domain";
import { truncate } from "@/lib/format";
import { excerpt, searchTerms } from "@/lib/highlight";
import { routes } from "@/lib/routes";
import { bestMatches, orderSuggestions, pageSuggestions, PER_GROUP, statusSuggestions, type Suggestion } from "@/lib/suggestions";

import { matchesTsQuery, prefixTsQuery, tsRank, type TsConfig } from "../db/fts";
import { goals, memories, tasks } from "../db/schema";
import { inTenant, type Ctx } from "./context";
import { invalid } from "./errors";
import { assertCan } from "./policy";
import { listAgents } from "./agents";
import { listDocuments } from "./documents";
import { SEARCH_KINDS, SearchInput, SuggestInput, type SearchKind } from "./schemas";
import { service } from "./service";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Goal/task status, or memory kind. */
  status: string;
  goalId: string | null;
  /** A task's due date; null for goals and memories. */
  dueDate: string | null;
  /** The text around the first match, so a result shows why it matched. */
  snippet: string;
  rank: number;
}

const noDate = sql<string | null>`null`;

/** Where each kind of hit comes from, and which of its columns fill the hit's fields. */
const SEARCHABLE = {
  goal: {
    table: goals,
    fields: { id: goals.id, title: goals.title, status: goals.status, goalId: goals.parentId, dueDate: noDate, snippet: goals.description },
  },
  task: {
    table: tasks,
    fields: { id: tasks.id, title: tasks.title, status: tasks.status, goalId: tasks.goalId, dueDate: tasks.dueDate, snippet: tasks.description },
  },
  memory: {
    table: memories,
    fields: { id: memories.id, title: memories.content, status: memories.kind, goalId: memories.goalId, dueDate: noDate, snippet: memories.content },
  },
} as const;

/** Memories have no title; their opening words stand in for one. */
const MEMORY_TITLE_LENGTH = 80;

async function searchKind(ctx: Ctx, kind: SearchKind, tsQuery: string, terms: readonly string[], limit: number, config: TsConfig = "english"): Promise<SearchHit[]> {
  const { table, fields } = SEARCHABLE[kind];
  const rank = tsRank(table.search, tsQuery, config);
  const rows = await ctx.db
    .select({ ...fields, rank })
    .from(table)
    .where(and(inTenant(ctx, table), matchesTsQuery(table.search, tsQuery, config)))
    .orderBy(desc(rank))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    kind,
    title: kind === "memory" ? truncate(row.title, MEMORY_TITLE_LENGTH) : row.title,
    snippet: excerpt(row.snippet, terms, 200),
  }));
}

export const search = service(SearchInput, async (ctx, { query, kinds, limit }): Promise<SearchHit[]> => {
  assertCan(ctx, "workspace:read");
  const tsQuery = prefixTsQuery(query);
  if (!tsQuery) throw invalid("The search query needs at least one word or number.");

  const terms = searchTerms(query);
  const results = await Promise.all((kinds ?? SEARCH_KINDS).map((kind) => searchKind(ctx, kind, tsQuery, terms, limit)));
  return results
    .flat()
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
});

/**
 * What search offers while a person types, for the search boxes' suggestions: pages to go to,
 * tasks to show by status or by the agent holding them, then the best goals, tasks and documents
 * by name, and how many memories match. Each group is short; the full results are on the Search page.
 */
export const suggest = service(SuggestInput, async (ctx, { query }): Promise<Suggestion[]> => {
  assertCan(ctx, "workspace:read");
  const slug = ctx.tenant.slug;
  const tsQuery = prefixTsQuery(query);
  const terms = searchTerms(query);
  // A prefix still being typed ("in") is read as written, so stopwords and half words still find things.
  const [goalHits, taskHits, memoryHits, documents, agents] = await Promise.all([
    tsQuery ? searchKind(ctx, "goal", tsQuery, terms, PER_GROUP, "prefix") : [],
    tsQuery ? searchKind(ctx, "task", tsQuery, terms, PER_GROUP, "prefix") : [],
    tsQuery ? searchKind(ctx, "memory", tsQuery, terms, MEMORY_COUNT_LIMIT, "prefix") : [],
    tsQuery ? listDocuments(ctx, { query, limit: PER_GROUP }) : [],
    listAgents(ctx, {}),
  ]);
  const holders = bestMatches(
    agents.filter((agent) => !agent.revokedAt),
    query,
    (agent) => agent.name,
  );
  const memories = memoryHits.length >= MEMORY_COUNT_LIMIT ? `${MEMORY_COUNT_LIMIT - 1}+` : String(memoryHits.length);

  return orderSuggestions([
    ...pageSuggestions(slug, query),
    ...statusSuggestions(slug, query),
    ...holders.map((agent) => ({ group: "filter" as const, key: `held:${agent.id}`, label: `Held by ${agent.name}`, detail: "Agent's tasks", href: routes.board(slug, { agent: agent.id }) })),
    ...goalHits.map((hit) => ({ group: "goal" as const, key: `goal:${hit.id}`, label: hit.title, detail: GOAL_STATUS_META[hit.status as keyof typeof GOAL_STATUS_META]?.label, href: routes.goal(slug, hit.id) })),
    ...taskHits.map((hit) => ({ group: "task" as const, key: `task:${hit.id}`, label: hit.title, detail: TASK_STATUS_META[hit.status as keyof typeof TASK_STATUS_META]?.label, href: routes.task(slug, hit.id) })),
    ...documents.map((document) => ({ group: "document" as const, key: `document:${document.id}`, label: document.title, detail: document.taskTitle ?? document.goalTitle ?? undefined, href: routes.document(slug, document.id) })),
    // Memories have no page of their own, so they are one way in: the Memory page searched for the words.
    ...(memoryHits.length
      ? [{ group: "memory" as const, key: "memory", label: `${memories} ${memoryHits.length === 1 ? "memory matches" : "memories match"}`, detail: memoryHits[0]!.title, href: routes.memory(slug, { q: query }) }]
      : []),
  ]);
});

/** Up to how many memories the suggestion counts before saying "N+". */
const MEMORY_COUNT_LIMIT = 10;
