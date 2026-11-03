import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appUrl, oauthProviders, platformAdminEmails, trustedOrigins } from "@/server/config";
import {
  DEFAULT_LOCAL_DATABASE_URL,
  isPostgresUrl,
  pgliteDataDir,
  postgresConnectionString,
  resolveDatabaseUrl,
} from "@/server/db/url";

const DEPLOYMENT_ENV = [
  "BETTER_AUTH_URL",
  "PHEAN_APP_URL",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "PORT",
  "PHEAN_PLATFORM_ADMINS",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "DATABASE_URL",
  "POSTGRES_URL",
];

beforeEach(() => {
  for (const name of DEPLOYMENT_ENV) vi.stubEnv(name, undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("app URL", () => {
  it("prefers an explicit URL, then the production domain, then the deployment URL, then localhost", () => {
    expect(appUrl()).toBe("http://localhost:3000");
    vi.stubEnv("PORT", "3100");
    expect(appUrl()).toBe("http://localhost:3100");

    vi.stubEnv("VERCEL_URL", "phean-abc123.vercel.app");
    expect(appUrl()).toBe("https://phean-abc123.vercel.app");

    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "phean.example");
    expect(appUrl()).toBe("https://phean-abc123.vercel.app");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(appUrl()).toBe("https://phean.example");

    vi.stubEnv("PHEAN_APP_URL", "https://app.phean.example/");
    expect(appUrl()).toBe("https://app.phean.example");
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.phean.example");
    expect(appUrl()).toBe("https://auth.phean.example");
  });

  it("trusts the app URL plus every Vercel host for this deployment", () => {
    vi.stubEnv("PHEAN_APP_URL", "https://phean.example");
    vi.stubEnv("VERCEL_URL", "phean-abc123.vercel.app");
    vi.stubEnv("VERCEL_BRANCH_URL", "phean-git-main.vercel.app");
    expect(trustedOrigins()).toEqual([
      "https://phean.example",
      "https://phean-abc123.vercel.app",
      "https://phean-git-main.vercel.app",
    ]);
  });
});

describe("operators and sign-in providers", () => {
  it("reads platform admins as a normalized email set", () => {
    expect(platformAdminEmails()).toEqual(new Set());
    vi.stubEnv("PHEAN_PLATFORM_ADMINS", " Ops@Phean.example, ,support@phean.example ");
    expect(platformAdminEmails()).toEqual(new Set(["ops@phean.example", "support@phean.example"]));
  });

  it("enables an OAuth provider only when both its id and secret are set", () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "gh-id");
    vi.stubEnv("GOOGLE_CLIENT_ID", "g-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "g-secret");
    expect(oauthProviders()).toEqual({ github: undefined, google: { clientId: "g-id", clientSecret: "g-secret" } });
  });
});

describe("database URL", () => {
  it("falls back to local PGlite, but refuses to on Vercel", () => {
    expect(resolveDatabaseUrl()).toBe(DEFAULT_LOCAL_DATABASE_URL);
    vi.stubEnv("VERCEL", "1");
    expect(() => resolveDatabaseUrl()).toThrow(/DATABASE_URL is not set/);
    vi.stubEnv("POSTGRES_URL", "postgres://u:p@pooler/db");
    expect(resolveDatabaseUrl()).toBe("postgres://u:p@pooler/db");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@direct/db");
    expect(resolveDatabaseUrl()).toBe("postgresql://u:p@direct/db");
  });

  it("tells Postgres URLs from PGlite ones", () => {
    expect(isPostgresUrl("postgres://u:p@host/db")).toBe(true);
    expect(isPostgresUrl("postgresql://u:p@host/db")).toBe(true);
    expect(isPostgresUrl(DEFAULT_LOCAL_DATABASE_URL)).toBe(false);
    expect(pgliteDataDir(DEFAULT_LOCAL_DATABASE_URL)).toBe("./.data/pglite");
    expect(pgliteDataDir("pglite:memory")).toBeUndefined();
  });

  it("pins certificate verification without touching other parameters", () => {
    expect(postgresConnectionString("postgresql://u:p%40ss@host.neon.tech/db?sslmode=require&channel_binding=require")).toBe(
      "postgresql://u:p%40ss@host.neon.tech/db?sslmode=verify-full&channel_binding=require",
    );
    expect(postgresConnectionString("postgres://u:p@localhost:5432/db?sslmode=disable")).toBe("postgres://u:p@localhost:5432/db?sslmode=disable");
    expect(postgresConnectionString("postgres://u:p@localhost:5432/db")).toBe("postgres://u:p@localhost:5432/db");
  });
});
