import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Converts free text into a safe prefix tsquery ("audit plan" -> "audit:* & plan:*"),
 * so user input never reaches the tsquery parser unescaped. Returns null when nothing is searchable.
 */
export function prefixTsQuery(text: string): string | null {
  const terms = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.length > 0 ? terms.map((term) => `${term}:*`).join(" & ") : null;
}

/**
 * How a query's words are read. `english` stems them and drops stopwords, right for whole words.
 * A prefix still being typed is neither: "in" is a stopword, yet "inv" should find "invoices", and
 * "invoice" is longer than the stored stem "invoic". `prefix` reads the words both ways, as written
 * (`simple`) and stemmed (`english`), and matches either.
 */
export type TsConfig = "english" | "prefix";

export function matchesTsQuery(column: AnyColumn, tsQuery: string, config: TsConfig = "english"): SQL {
  return config === "prefix"
    ? sql`(${column} @@ to_tsquery('english', ${tsQuery}) or ${column} @@ to_tsquery('simple', ${tsQuery}))`
    : sql`${column} @@ to_tsquery('english', ${tsQuery})`;
}

export function tsRank(column: AnyColumn, tsQuery: string, config: TsConfig = "english"): SQL<number> {
  return (
    config === "prefix"
      ? sql`greatest(ts_rank(${column}, to_tsquery('english', ${tsQuery})), ts_rank(${column}, to_tsquery('simple', ${tsQuery})))`
      : sql`ts_rank(${column}, to_tsquery('english', ${tsQuery}))`
  ).mapWith(Number);
}
