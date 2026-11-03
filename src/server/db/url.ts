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

/**
 * node-postgres currently treats sslmode=prefer|require|verify-ca (Neon URLs use require) as
 * verify-full, and warns that pg v9 will weaken them to libpq semantics. Pinning verify-full
 * keeps certificate verification across that upgrade.
 */
export function postgresConnectionString(url: string): string {
  const parsed = new URL(url);
  if (["prefer", "require", "verify-ca"].includes(parsed.searchParams.get("sslmode") ?? "")) {
    parsed.searchParams.set("sslmode", "verify-full");
  }
  return parsed.toString();
}

export function pgliteDataDir(url: string): string | undefined {
  const target = url.replace(/^pglite:/, "");
  return target === "memory" ? undefined : target;
}
