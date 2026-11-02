import { getTableColumns, type Table } from "drizzle-orm";

/** Table columns minus internal ones (tenant id, search vectors) for use in `select`/`returning`. */
export function publicColumns<T extends Table, K extends keyof T["_"]["columns"]>(
  table: T,
  omit: readonly K[],
): Omit<T["_"]["columns"], K> {
  const columns = { ...getTableColumns(table) };
  for (const key of omit) delete columns[key];
  return columns;
}
