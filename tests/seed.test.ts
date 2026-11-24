import { spawnSync } from "node:child_process";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { queryRows } from "@/server/db/raw";

import { seedSampleCustomers } from "../scripts/sample-customers";
import { createTestDb } from "./support/db";

describe("pnpm db:seed", () => {
  it("refuses to run on a production deployment", () => {
    const run = spawnSync("pnpm", ["exec", "tsx", "scripts/seed.ts"], {
      encoding: "utf8",
      env: { ...process.env, VERCEL_ENV: "production", DATABASE_URL: "pglite:memory" },
      timeout: 60_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Refusing to seed");
  }, 60_000);
});

describe("sample customers", () => {
  it("date nothing after now, and add nothing the second time", async () => {
    const { db, close } = await createTestDb();
    try {
      // Early in a UTC day, when "today's" samples would otherwise fall later in the day than now.
      const today = new Date();
      const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 8));
      expect(await seedSampleCustomers(db, now)).toBe(12);
      const [future] = await queryRows<{ users: number; events: number; tasks: number; answers: number }>(
        db,
        sql`select (select count(*)::int from "user" where created_at > ${now.toISOString()}::timestamp) as users,
              (select count(*)::int from events where created_at > ${now.toISOString()}::timestamptz) as events,
              (select count(*)::int from tasks where created_at > ${now.toISOString()}::timestamptz or completed_at > ${now.toISOString()}::timestamptz) as tasks,
              (select count(*)::int from tasks t cross join lateral jsonb_array_elements(t.input_answers) a
                 where (a->>'closedAt')::timestamptz > ${now.toISOString()}::timestamptz) as answers`,
      );
      expect(future).toEqual({ users: 0, events: 0, tasks: 0, answers: 0 });
      expect(await seedSampleCustomers(db, now)).toBe(0);
    } finally {
      await close();
    }
  });
});
