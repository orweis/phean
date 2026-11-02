import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

import { pgliteDataDir } from "./url";

export function openPglite(url: string): PGlite {
  const dataDir = pgliteDataDir(url);
  if (dataDir) mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
  return new PGlite(dataDir);
}
