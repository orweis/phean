import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Converts free text into a safe prefix tsquery ("audit plan" -> "audit:* & plan:*"),
 * so user input never reaches the tsquery parser unescaped. Returns null when nothing is searchable.
 */
export function prefixTsQuery(text: string): string | null {
  const terms = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.length > 0 ? terms.map((term) => `${term}:*`).join(" & ") : null;
}

export function matchesTsQuery(column: AnyColumn, tsQuery: string): SQL {
  return sql`${column} @@ to_tsquery('english', ${tsQuery})`;
}

export function tsRank(column: AnyColumn, tsQuery: string): SQL<number> {
  return sql`ts_rank(${column}, to_tsquery('english', ${tsQuery}))`.mapWith(Number);
}
