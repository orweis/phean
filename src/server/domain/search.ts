import { and, desc } from "drizzle-orm";

import { truncate } from "@/lib/format";

import { matchesTsQuery, prefixTsQuery, tsRank } from "../db/fts";
import { goals, memories, tasks } from "../db/schema";
import { inTenant, type Ctx } from "./context";
import { invalid } from "./errors";
import { assertCan } from "./policy";
import { SEARCH_KINDS, SearchInput, type SearchKind } from "./schemas";
import { service } from "./service";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Goal/task status, or memory kind. */
  status: string;
  goalId: string | null;
  snippet: string;
  rank: number;
}

/** Where each kind of hit comes from, and which of its columns fill the hit's fields. */
const SEARCHABLE = {
  goal: {
    table: goals,
    fields: { id: goals.id, title: goals.title, status: goals.status, goalId: goals.parentId, snippet: goals.description },
  },
  task: {
    table: tasks,
    fields: { id: tasks.id, title: tasks.title, status: tasks.status, goalId: tasks.goalId, snippet: tasks.description },
  },
  memory: {
    table: memories,
    fields: { id: memories.id, title: memories.content, status: memories.kind, goalId: memories.goalId, snippet: memories.content },
  },
} as const;

/** Memories have no title; their opening words stand in for one. */
const MEMORY_TITLE_LENGTH = 80;

async function searchKind(ctx: Ctx, kind: SearchKind, tsQuery: string, limit: number): Promise<SearchHit[]> {
  const { table, fields } = SEARCHABLE[kind];
  const rank = tsRank(table.search, tsQuery);
  const rows = await ctx.db
    .select({ ...fields, rank })
    .from(table)
    .where(and(inTenant(ctx, table), matchesTsQuery(table.search, tsQuery)))
    .orderBy(desc(rank))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    kind,
    title: kind === "memory" ? truncate(row.title, MEMORY_TITLE_LENGTH) : row.title,
    snippet: truncate(row.snippet, 200),
  }));
}

export const search = service(SearchInput, async (ctx, { query, kinds, limit }): Promise<SearchHit[]> => {
  assertCan(ctx, "workspace:read");
  const tsQuery = prefixTsQuery(query);
  if (!tsQuery) throw invalid("The search query needs at least one word or number.");

  const results = await Promise.all((kinds ?? SEARCH_KINDS).map((kind) => searchKind(ctx, kind, tsQuery, limit)));
  return results
    .flat()
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
});
