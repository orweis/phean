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

type Patch<T> = Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;

/** An update's `set` from optional input fields: undefined means "leave as is", null means "clear". */
export function patchOf<T extends Record<string, unknown>>(fields: T): Patch<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Patch<T>;
}
