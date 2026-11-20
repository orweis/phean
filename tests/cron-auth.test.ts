import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as digest } from "@/app/api/digest/route";
import { GET as dispatch } from "@/app/api/webhooks/dispatch/route";
import { isAuthorizedCronRequest } from "@/server/cron-auth";

function call(authorization?: string): Request {
  return new Request("https://phean.test/api/webhooks/dispatch", { headers: authorization ? { authorization } : {} });
}

const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

afterEach(() => vi.unstubAllEnvs());

describe("cron route authorization", () => {
  const secret = "s3cret-value";

  it("accepts exactly the bearer CRON_SECRET when one is set", () => {
    for (const NODE_ENV of ["development", "production"]) {
      const withSecret = env({ CRON_SECRET: secret, NODE_ENV });
      expect(isAuthorizedCronRequest(call(`Bearer ${secret}`), withSecret)).toBe(true);
      expect(isAuthorizedCronRequest(call(), withSecret)).toBe(false);
      expect(isAuthorizedCronRequest(call(secret), withSecret)).toBe(false);
      expect(isAuthorizedCronRequest(call(`Bearer ${secret}x`), withSecret)).toBe(false);
      expect(isAuthorizedCronRequest(call(`Bearer ${secret.slice(0, -1)}`), withSecret)).toBe(false);
      expect(isAuthorizedCronRequest(call("Bearer "), withSecret)).toBe(false);
      expect(isAuthorizedCronRequest(call(`bearer ${secret}`), withSecret)).toBe(false);
    }
  });

  it("fails closed without CRON_SECRET anywhere but a local development server", () => {
    expect(isAuthorizedCronRequest(call(), env({ NODE_ENV: "development" }))).toBe(true);
    expect(isAuthorizedCronRequest(call(), env({ NODE_ENV: "test" }))).toBe(true);
    expect(isAuthorizedCronRequest(call(), env({ NODE_ENV: "development", VERCEL_ENV: "development" }))).toBe(true);
    // A self-hosted production server has no VERCEL_ENV at all.
    expect(isAuthorizedCronRequest(call(), env({ NODE_ENV: "production" }))).toBe(false);
    expect(isAuthorizedCronRequest(call("Bearer anything"), env({ NODE_ENV: "production" }))).toBe(false);
    expect(isAuthorizedCronRequest(call(), env({ NODE_ENV: "production", VERCEL_ENV: "preview" }))).toBe(false);
    expect(isAuthorizedCronRequest(call(), env({ NODE_ENV: "production", VERCEL_ENV: "production" }))).toBe(false);
    expect(isAuthorizedCronRequest(call(), env({ NODE_ENV: "development", VERCEL_ENV: "preview" }))).toBe(false);
  });

  it("treats an empty CRON_SECRET as unset rather than as a secret everyone knows", () => {
    expect(isAuthorizedCronRequest(call("Bearer "), env({ CRON_SECRET: "", NODE_ENV: "production" }))).toBe(false);
  });

  it("guards both cron routes before they touch the database", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    for (const route of [dispatch, digest]) expect((await route(call("Bearer wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", undefined);
    vi.stubEnv("NODE_ENV", "production");
    for (const route of [dispatch, digest]) expect((await route(call())).status).toBe(401);
  });
});
