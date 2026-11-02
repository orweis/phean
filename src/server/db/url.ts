/**
 * DATABASE_URL forms:
 *   postgres://... | postgresql://...   real Postgres (Neon in production)
 *   pglite:./.data/pglite               embedded PGlite on disk (local development default)
 *   pglite:memory                       embedded, in-memory PGlite
 */

export const DEFAULT_LOCAL_DATABASE_URL = "pglite:./.data/pglite";

export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (url) return url;
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Connect a Neon Postgres database to this Vercel project.");
  }
  return DEFAULT_LOCAL_DATABASE_URL;
}

export function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export function pgliteDataDir(url: string): string | undefined {
  const target = url.replace(/^pglite:/, "");
  return target === "memory" ? undefined : target;
}
