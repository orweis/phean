import { and, desc, eq } from "drizzle-orm";

import { truncate } from "@/lib/format";

import { matchesTsQuery, prefixTsQuery, tsRank } from "../db/fts";
import { goals, memories, tasks } from "../db/schema";
import type { Ctx } from "./context";
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

type Searcher = (ctx: Ctx, tsQuery: string, limit: number) => Promise<SearchHit[]>;

const SEARCHERS: Record<SearchKind, Searcher> = {
  goal: async (ctx, tsQuery, limit) => {
    const rows = await ctx.db
      .select({
        id: goals.id,
        title: goals.title,
        status: goals.status,
        goalId: goals.parentId,
        snippet: goals.description,
        rank: tsRank(goals.search, tsQuery),
      })
      .from(goals)
      .where(and(eq(goals.tenantId, ctx.tenant.id), matchesTsQuery(goals.search, tsQuery)))
      .orderBy(desc(tsRank(goals.search, tsQuery)))
      .limit(limit);
    return rows.map((row) => ({ ...row, kind: "goal" as const }));
  },
  task: async (ctx, tsQuery, limit) => {
    const rows = await ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        goalId: tasks.goalId,
        snippet: tasks.description,
        rank: tsRank(tasks.search, tsQuery),
      })
      .from(tasks)
      .where(and(eq(tasks.tenantId, ctx.tenant.id), matchesTsQuery(tasks.search, tsQuery)))
      .orderBy(desc(tsRank(tasks.search, tsQuery)))
      .limit(limit);
    return rows.map((row) => ({ ...row, kind: "task" as const }));
  },
  memory: async (ctx, tsQuery, limit) => {
    const rows = await ctx.db
      .select({
        id: memories.id,
        content: memories.content,
        status: memories.kind,
        goalId: memories.goalId,
        rank: tsRank(memories.search, tsQuery),
      })
      .from(memories)
      .where(and(eq(memories.tenantId, ctx.tenant.id), matchesTsQuery(memories.search, tsQuery)))
      .orderBy(desc(tsRank(memories.search, tsQuery)))
      .limit(limit);
    return rows.map(({ content, ...row }) => ({
      ...row,
      kind: "memory" as const,
      title: truncate(content, 80),
      snippet: content,
    }));
  },
};

export const search = service(SearchInput, async (ctx, { query, kinds, limit }): Promise<SearchHit[]> => {
  assertCan(ctx, "workspace:read");
  const tsQuery = prefixTsQuery(query);
  if (!tsQuery) throw invalid("The search query needs at least one word or number.");

  const results = await Promise.all(
    (kinds ?? SEARCH_KINDS).map((kind) => SEARCHERS[kind](ctx, tsQuery, limit)),
  );
  return results
    .flat()
    .map((hit) => ({ ...hit, snippet: truncate(hit.snippet, 200) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
});
