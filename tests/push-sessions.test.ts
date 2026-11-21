import { randomBytes } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuth, type Auth } from "@/server/auth/auth";
import { pushDevices, session, verification } from "@/server/db/schema";

import { addMember, createTestDb, seedTenant, type TestDb } from "./support/db";
import { jsonPost, OAUTH_BASE } from "./support/oauth";
import { deviceFor } from "./support/push";

const BASE = OAUTH_BASE;
const PASSWORD = "correct-horse-battery";

let testDb: TestDb;
let auth: Auth;

beforeEach(async () => {
  testDb = await createTestDb();
  vi.stubEnv("BETTER_AUTH_URL", BASE);
  vi.stubEnv("BETTER_AUTH_SECRET", "phean-push-tests-only-secret-0123456789");
  auth = createAuth(testDb.db, BASE);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await testDb.close();
});

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0]!)
    .filter((pair) => !pair.endsWith("="))
    .join("; ");

const post = (path: string, cookie: string, body: unknown = {}) => auth.handler(jsonPost(`${BASE}/api/auth${path}`, body, { cookie, origin: BASE }));

interface Browsers {
  userId: string;
  /** Two signed-in browsers of one person, each with a notification device turned on in its session. */
  browsers: { cookie: string; sessionId: string; token: string; deviceId: string }[];
}

async function signedInTwice(): Promise<Browsers> {
  const email = `${randomBytes(6).toString("hex")}@example.com`;
  const signUp = await auth.handler(jsonPost(`${BASE}/api/auth/sign-up/email`, { name: "Dana", email, password: PASSWORD }, { origin: BASE }));
  const { user } = (await signUp.json()) as { user: { id: string } };
  await addMember(testDb.db, await seedTenant(testDb.db, `acme-${randomBytes(3).toString("hex")}`), { id: user.id, name: "Dana", email }, "owner");
  const signIn = await auth.handler(jsonPost(`${BASE}/api/auth/sign-in/email`, { email, password: PASSWORD }, { origin: BASE }));
  const cookies = [cookieOf(signUp), cookieOf(signIn)];
  const sessions = await testDb.db.select({ id: session.id, token: session.token }).from(session).where(eq(session.userId, user.id)).orderBy(asc(session.createdAt));
  expect(sessions).toHaveLength(2);
  const browsers = [];
  for (const [index, row] of sessions.entries()) {
    const device = await deviceFor(testDb.db, { id: user.id, name: "Dana" }, { sessionId: row.id });
    browsers.push({ cookie: cookies[index]!, sessionId: row.id, token: row.token, deviceId: device.id });
  }
  return { userId: user.id, browsers };
}

async function devicesLeft(userId: string): Promise<string[]> {
  const rows = await testDb.db.select({ id: pushDevices.id }).from(pushDevices).where(eq(pushDevices.userId, userId));
  return rows.map((row) => row.id).sort();
}

describe("devices end with their sessions", () => {
  it("signing out deletes this session's device only", async () => {
    const { userId, browsers } = await signedInTwice();
    const [first, second] = browsers;
    expect((await post("/sign-out", first!.cookie)).status).toBe(200);
    expect(await devicesLeft(userId)).toEqual([second!.deviceId]);
  });

  it("revoking one session from the Account page deletes that session's device", async () => {
    const { userId, browsers } = await signedInTwice();
    const [first, second] = browsers;
    expect((await post("/revoke-session", first!.cookie, { token: second!.token })).status).toBe(200);
    expect(await devicesLeft(userId)).toEqual([first!.deviceId]);
    // Another person's token names nothing of theirs: nothing more goes.
    expect((await post("/revoke-session", first!.cookie, { token: "not-a-token" })).status).toBe(200);
    expect(await devicesLeft(userId)).toEqual([first!.deviceId]);
  });

  it("revoking the other sessions keeps this one's device", async () => {
    const { userId, browsers } = await signedInTwice();
    const [first] = browsers;
    expect((await post("/revoke-other-sessions", first!.cookie)).status).toBe(200);
    expect(await devicesLeft(userId)).toEqual([first!.deviceId]);
  });

  it("revoking every session deletes every device", async () => {
    const { userId, browsers } = await signedInTwice();
    expect((await post("/revoke-sessions", browsers[0]!.cookie)).status).toBe(200);
    expect(await devicesLeft(userId)).toEqual([]);
  });

  it("changing the password with sign out everywhere else deletes the other sessions' devices", async () => {
    const { userId, browsers } = await signedInTwice();
    const [first] = browsers;
    const changed = await post("/change-password", first!.cookie, { currentPassword: PASSWORD, newPassword: "another-horse-battery", revokeOtherSessions: true });
    expect(changed.status).toBe(200);
    expect(await devicesLeft(userId)).toEqual([first!.deviceId]);
  });

  it("a password reset ends every session and every device", async () => {
    const { userId } = await signedInTwice();
    const token = randomBytes(16).toString("hex");
    await testDb.db.insert(verification).values({ id: randomBytes(8).toString("hex"), identifier: `reset-password:${token}`, value: userId, expiresAt: new Date(Date.now() + 60_000) });
    const reset = await auth.handler(jsonPost(`${BASE}/api/auth/reset-password`, { token, newPassword: "another-horse-battery" }, { origin: BASE }));
    expect(reset.status).toBe(200);
    expect(await devicesLeft(userId)).toEqual([]);
    expect(await testDb.db.select().from(session).where(eq(session.userId, userId))).toEqual([]);
  });
});
