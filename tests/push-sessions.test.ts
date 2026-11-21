import { randomBytes } from "node:crypto";

import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { totpCode } from "../e2e/support/totp";
import { createAuth, type Auth } from "@/server/auth/auth";
import { pushDevices, session, verification } from "@/server/db/schema";
import { personContext } from "@/server/domain/context";
import { forgetBrowserDevice, tieDevice } from "@/server/domain/notifications";

import { addMember, createTestDb, seedTenant, seedUser, type TestDb } from "./support/db";
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

/** A browser's cookies across requests: each response's Set-Cookie replaces or expires what it names. */
class Jar {
  private cookies = new Map<string, string>();

  take(response: Response): Response {
    for (const line of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = line.split(";");
      const [name = "", ...value] = pair.split("=");
      const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expired || value.join("=") === "") this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value.join("="));
    }
    return response;
  }

  get header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** One signed-in browser with a device turned on in its session, whose cookies follow every rotation. */
async function browserWithDevice() {
  const jar = new Jar();
  const send = async (path: string, body: unknown = {}) => jar.take(await post(path, jar.header, body));
  const email = `${randomBytes(6).toString("hex")}@example.com`;
  const signUp = await send("/sign-up/email", { name: "Dana", email, password: PASSWORD });
  const { user: person } = (await signUp.json()) as { user: { id: string } };
  await addMember(testDb.db, await seedTenant(testDb.db, `acme-${randomBytes(3).toString("hex")}`), { id: person.id, name: "Dana", email }, "owner");
  const sessionNow = async () => (await testDb.db.select({ id: session.id }).from(session).where(eq(session.userId, person.id)).orderBy(asc(session.createdAt))).map((row) => row.id);
  const [sessionId] = await sessionNow();
  const device = await deviceFor(testDb.db, { id: person.id, name: "Dana" }, { sessionId });
  const deviceSession = async () => (await testDb.db.select({ sessionId: pushDevices.sessionId }).from(pushDevices).where(eq(pushDevices.id, device.id)))[0]?.sessionId;
  return { userId: person.id, email, device, send, sessionNow, deviceSession };
}

describe("devices follow their browser's session when it rotates", () => {
  it("sign out after change-password with revokeOtherSessions removes the device", async () => {
    const browser = await browserWithDevice();
    const changed = await browser.send("/change-password", { currentPassword: PASSWORD, newPassword: "another-horse-battery", revokeOtherSessions: true });
    expect(changed.status).toBe(200);
    const sessions = await browser.sessionNow();
    expect(sessions).toHaveLength(1);
    expect(await browser.deviceSession()).toBe(sessions[0]);
    expect((await browser.send("/sign-out")).status).toBe(200);
    expect(await devicesLeft(browser.userId)).toEqual([]);
  });

  it("a failed password change deletes no device", async () => {
    const { userId, browsers } = await signedInTwice();
    const refused = await post("/change-password", browsers[0]!.cookie, { currentPassword: "not-the-password", newPassword: "another-horse-battery", revokeOtherSessions: true });
    expect(refused.status).toBe(400);
    expect(await devicesLeft(userId)).toEqual(browsers.map((browser) => browser.deviceId).sort());
  });

  it("turning two-factor on keeps the device with this browser's session", async () => {
    const browser = await browserWithDevice();
    const enabled = await browser.send("/two-factor/enable", { password: PASSWORD });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    expect((await browser.send("/two-factor/verify-totp", { code: totpCode(totpURI) })).status).toBe(200);
    const sessions = await browser.sessionNow();
    expect(sessions).toHaveLength(1);
    expect(await browser.deviceSession()).toBe(sessions[0]);
    expect((await browser.send("/sign-out")).status).toBe(200);
    expect(await devicesLeft(browser.userId)).toEqual([]);
  });

  it("turning two-factor off keeps the device with this browser's session", async () => {
    const browser = await browserWithDevice();
    const enabled = await browser.send("/two-factor/enable", { password: PASSWORD });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    expect((await browser.send("/two-factor/verify-totp", { code: totpCode(totpURI) })).status).toBe(200);
    expect((await browser.send("/two-factor/disable", { password: PASSWORD })).status).toBe(200);
    const sessions = await browser.sessionNow();
    expect(sessions).toHaveLength(1);
    expect(await browser.deviceSession()).toBe(sessions[0]);
    expect((await browser.send("/sign-out")).status).toBe(200);
    expect(await devicesLeft(browser.userId)).toEqual([]);
  });

  it("a device whose session expired is tied again on load, and goes when that browser signs out", async () => {
    const browser = await browserWithDevice();
    // The session expired and its row went; the browser signs in again.
    await testDb.db.delete(session).where(eq(session.userId, browser.userId));
    expect(await browser.deviceSession()).toBeNull();
    expect((await browser.send("/sign-in/email", { email: browser.email, password: PASSWORD })).status).toBe(200);
    const [fresh] = await browser.sessionNow();
    const person = personContext(testDb.db, { id: browser.userId, name: "Dana" });
    await expect(tieDevice(person, { endpoint: browser.device.endpoint }, { sessionId: fresh! })).resolves.toEqual({ tied: true });
    expect(await browser.deviceSession()).toBe(fresh);
    expect((await browser.send("/sign-out")).status).toBe(200);
    expect(await devicesLeft(browser.userId)).toEqual([]);
  });

  it("signing out forgets this browser's device by its endpoint, whatever session it was tied to", async () => {
    const browser = await browserWithDevice();
    await testDb.db.update(pushDevices).set({ sessionId: null }).where(eq(pushDevices.id, browser.device.id));
    const stranger = await seedUser(testDb.db, "Stranger");
    // Only the person's own device: another person's endpoint is left alone, and so is a tie to it.
    await expect(forgetBrowserDevice(personContext(testDb.db, stranger), { endpoint: browser.device.endpoint })).resolves.toEqual({ forgotten: false });
    await expect(tieDevice(personContext(testDb.db, stranger), { endpoint: browser.device.endpoint }, { sessionId: null })).resolves.toEqual({ tied: false });
    await expect(forgetBrowserDevice(personContext(testDb.db, { id: browser.userId, name: "Dana" }), { endpoint: browser.device.endpoint })).resolves.toEqual({ forgotten: true });
    expect(await devicesLeft(browser.userId)).toEqual([]);
  });
});
