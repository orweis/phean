import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { isoDayFromToday } from "@/lib/dates";
import { routes } from "@/lib/routes";
import { digestSubscriptions, member } from "@/server/db/schema";
import { getDigest, getDigestSubscription, saveDigestSubscription, stopDigestSubscription } from "@/server/domain/digest";
import { createGoal } from "@/server/domain/goals";
import { captureTasks, claimTask, completeTask, requestInput, type Task } from "@/server/domain/tasks";
import type { Email } from "@/server/digest/email";
import { renderDigestEmail } from "@/server/digest/render";
import { hourIn, sendDueDigests } from "@/server/digest/send";

import { createTestDb, seedWorkspace, type TestDb, type Workspace } from "./support/db";

let testDb: TestDb;
let acme: Workspace;

beforeAll(async () => {
  testDb = await createTestDb();
});

beforeEach(async () => {
  acme = await seedWorkspace(testDb.db);
});

afterAll(() => testDb.close());

/** A morning in Acme: one late task, one finished, one question for a person, one goal to approve. */
async function busyMorning() {
  const scout = acme.scout.ctx;
  const { created } = await captureTasks(scout, {
    tasks: [
      { title: "Chase the overdue invoice", dueDate: isoDayFromToday(-2) },
      { title: "Reconcile the card spend" },
      { title: "Pick the auditor" },
    ],
  });
  const [late, finished, asked] = created as [Task, Task, Task];
  await claimTask(scout, { taskId: finished.id });
  await completeTask(scout, { taskId: finished.id, note: "Matched all 41." });
  await requestInput(scout, { taskId: asked.id, kind: "decision", question: "Which auditor?", options: ["Okafor LLP", "Brandt & Co"] });
  await createGoal(scout, { title: "Renew the lease" });
  return { late, finished, asked };
}

/** The UTC hour it is now, so a subscription in UTC is due this run. */
const thisHour = (now: Date) => hourIn("UTC", now);

describe("the morning digest", () => {
  it("leads with what waits on the person, then what is late and what was finished, each with its link", async () => {
    const { late, finished, asked } = await busyMorning();
    const digest = await getDigest(acme.human, {});
    const slug = acme.tenant.slug;

    expect(digest.quiet).toBe(false);
    expect(digest.captured).toBe(3);
    expect(digest.waiting.items).toEqual([
      { title: "Which auditor?", detail: "Scout asked, on “Pick the auditor”", href: routes.decision(slug, asked.id) },
      { title: "Approve “Renew the lease”", detail: "Goal proposed by Scout", href: routes.approvals(slug) },
    ]);
    expect(digest.late.items).toEqual([expect.objectContaining({ title: late.title, href: routes.task(slug, late.id), detail: expect.stringMatching(/2 days late/) })]);
    expect(digest.finished.items).toEqual([{ title: finished.title, detail: "Done by Scout", href: routes.task(slug, finished.id) }]);
  });

  it("looks back only to the last digest, and calls a morning with nothing in it quiet", async () => {
    await busyMorning();
    const later = await getDigest(acme.human, { since: new Date(Date.now() + 60_000).toISOString() });
    expect(later.finished.count).toBe(0);
    expect(later.captured).toBe(0);
    // What waits and what is late still counts: it has not gone away.
    expect(later.waiting.count).toBe(2);
    expect((await getDigest((await seedWorkspace(testDb.db, { name: "Empty" })).human, {})).quiet).toBe(true);
  });

  it("lists the first few of a section and counts the rest", async () => {
    await captureTasks(acme.scout.ctx, { tasks: Array.from({ length: 7 }, (_, index) => ({ title: `Late ${index}`, dueDate: isoDayFromToday(-1) })) });
    const { late } = await getDigest(acme.human, {});
    expect(late.count).toBe(7);
    expect(late.items).toHaveLength(5);
  });

  it("is a person's to subscribe to, change and stop; agents cannot", async () => {
    expect(await getDigestSubscription(acme.human, {})).toBeNull();
    await saveDigestSubscription(acme.human, { hour: 7, timeZone: "Europe/Berlin" });
    await saveDigestSubscription(acme.human, { hour: "9" as unknown as number, timeZone: "Europe/Berlin" });
    expect(await getDigestSubscription(acme.human, {})).toMatchObject({ hour: 9, timeZone: "Europe/Berlin", lastSentAt: null });
    await expect(saveDigestSubscription(acme.human, { hour: 24, timeZone: "UTC" })).rejects.toMatchObject({ code: "invalid" });
    await expect(saveDigestSubscription(acme.human, { hour: 7, timeZone: "Mars/Olympus" })).rejects.toMatchObject({ code: "invalid" });
    await expect(saveDigestSubscription(acme.scout.ctx, { hour: 7, timeZone: "UTC" })).rejects.toMatchObject({ code: "forbidden" });
    await stopDigestSubscription(acme.human, {});
    expect(await getDigestSubscription(acme.human, {})).toBeNull();
  });

  it("keeps each workspace's digest and subscriptions to itself", async () => {
    await busyMorning();
    const globex = await seedWorkspace(testDb.db, { name: "Globex" });
    await saveDigestSubscription(acme.human, { hour: 7, timeZone: "UTC" });
    expect(await getDigestSubscription(globex.human, {})).toBeNull();
    expect((await getDigest(globex.human, {})).quiet).toBe(true);
  });
});

describe("sending the digest", () => {
  it("emails each digest once, at its hour in its person's time zone", async () => {
    await busyMorning();
    const now = new Date();
    await saveDigestSubscription(acme.human, { hour: thisHour(now), timeZone: "UTC" });
    const sent: Email[] = [];
    const send = async (email: Email) => void sent.push(email);

    const first = await sendDueDigests(testDb.db, { now, send, baseUrl: "https://phean.example" });
    expect(first).toMatchObject({ sent: 1, failed: 0 });
    expect(sent[0]!.subject).toBe(`${acme.tenant.name}: 2 things waiting on you, 1 late, 1 done`);
    expect(sent[0]!.html).toContain(`https://phean.example${routes.digest(acme.tenant.slug)}`);
    expect(sent[0]!.text).toContain("Which auditor?");

    // A second run in the same hour, or an overlapping one, does not send the morning again.
    expect(await sendDueDigests(testDb.db, { now: new Date(now.getTime() + 60_000), send })).toMatchObject({ due: 0, sent: 0 });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing outside the hour, on a quiet morning, or to someone who left the workspace", async () => {
    const now = new Date();
    const sent: Email[] = [];
    const send = async (email: Email) => void sent.push(email);
    await saveDigestSubscription(acme.human, { hour: (thisHour(now) + 1) % 24, timeZone: "UTC" });
    expect(await sendDueDigests(testDb.db, { now, send })).toMatchObject({ due: 0 });

    await saveDigestSubscription(acme.human, { hour: thisHour(now), timeZone: "UTC" });
    expect(await sendDueDigests(testDb.db, { now, send })).toMatchObject({ due: 1, quiet: 1, sent: 0 });

    const other = await seedWorkspace(testDb.db, { name: "Initech" });
    await busyMorningIn(other);
    await saveDigestSubscription(other.human, { hour: thisHour(now), timeZone: "UTC" });
    await testDb.db.delete(member).where(eq(member.organizationId, other.tenant.id));
    expect(await sendDueDigests(testDb.db, { now, send })).toMatchObject({ due: 0 });
    expect(sent).toEqual([]);
  });

  it("gives the morning back when the email fails, so the next run tries again", async () => {
    await busyMorning();
    const now = new Date();
    await saveDigestSubscription(acme.human, { hour: thisHour(now), timeZone: "UTC" });
    const failing = async () => {
      throw new Error("Resend is down");
    };
    expect(await sendDueDigests(testDb.db, { now, send: failing })).toMatchObject({ due: 1, failed: 1 });
    const [row] = await testDb.db.select().from(digestSubscriptions).where(eq(digestSubscriptions.tenantId, acme.tenant.id));
    expect(row!.lastSentAt).toBeNull();
    const sent: Email[] = [];
    expect(await sendDueDigests(testDb.db, { now, send: async (email) => void sent.push(email) })).toMatchObject({ sent: 1 });
  });

  it("escapes what agents wrote, so a title cannot inject markup into the email", async () => {
    await captureTasks(acme.scout.ctx, { tasks: [{ title: `<img src=x onerror="alert(1)"> late`, dueDate: isoDayFromToday(-1) }] });
    const email = renderDigestEmail(await getDigest(acme.human, {}), "https://phean.example", "dana@example.com");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&#60;img src=x");
  });
});

/** The same morning, in another workspace. */
async function busyMorningIn(workspace: Workspace) {
  await captureTasks(workspace.scout.ctx, { tasks: [{ title: "Late elsewhere", dueDate: isoDayFromToday(-3) }] });
}
