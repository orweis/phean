/**
 * Twelve weeks of sample customers for the backoffice: people signing up week by week, some creating
 * a workspace, connecting agents through Claude Code, Cursor or VS Code, asking and answering
 * decisions, handing work off, and coming back (or not). Rows and events are written directly with
 * backdated timestamps, as `sample-history.ts` does. Skips customers that already exist, so it is
 * safe to re-run. Local and UI-test data only; never run against a real deployment.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import type { InputAnswer, InputRequest } from "../src/lib/agent-sessions";
import { addDays, DAY_MS, isoDate, startOfUtcDay } from "../src/lib/dates";
import type { AgentAccessLevel, TaskStatus } from "../src/lib/domain";
import type { Db } from "../src/server/db/client";
import { newId } from "../src/server/db/ids";
import { account, agents, events, member, oauthClient, organization, tasks, toolCallsDaily, user, webhooks } from "../src/server/db/schema";
import { encryptSecret, newWebhookSecret } from "../src/server/webhooks/signing";

/** The OAuth clients sample agents connect with, by the names their makers register. */
const CLIENTS = [
  { clientId: "sample-claude-code", name: "Claude Code" },
  { clientId: "sample-cursor", name: "Cursor" },
  { clientId: "sample-vscode", name: "Visual Studio Code" },
] as const;
type ClientKey = (typeof CLIENTS)[number]["clientId"];

interface SampleCustomer {
  person: string;
  /** Weeks ago they signed up (0 = this week). */
  signedUp: number;
  workspace?: string;
  /** Agents they connect, by client and level. */
  agents?: [ClientKey | "key", AgentAccessLevel][];
  /** Weeks since signup they were active (0 = their first week); empty means they never came back. */
  activeWeeks?: number[];
  /** Decisions per active week. */
  decisions?: number;
  /** A webhook that keeps failing. */
  failingWebhook?: boolean;
  /** A request left open, days ago. */
  stuckDays?: number;
  signIn: "github" | "google" | "credential";
}

/** A mix that makes every step of the funnel and every flag show something. */
const CUSTOMERS: SampleCustomer[] = [
  { person: "Ana Ortiz", signedUp: 11, workspace: "Ortiz Logistics", agents: [["sample-claude-code", "write"], ["sample-claude-code", "read"]], activeWeeks: [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11], decisions: 4, signIn: "github" },
  { person: "Ben Kato", signedUp: 10, workspace: "Kato Studio", agents: [["sample-cursor", "write"]], activeWeeks: [0, 1, 3], decisions: 2, signIn: "google" },
  { person: "Chloe Park", signedUp: 9, workspace: "Park Legal", agents: [["sample-vscode", "admin"], ["key", "write"]], activeWeeks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], decisions: 6, failingWebhook: true, signIn: "credential" },
  { person: "Dev Iyer", signedUp: 8, signIn: "github" },
  { person: "Ema Novak", signedUp: 7, workspace: "Novak Bakery", agents: [["sample-claude-code", "write"]], activeWeeks: [0, 2, 4, 6], decisions: 1, stuckDays: 5, signIn: "google" },
  { person: "Femi Ade", signedUp: 6, workspace: "Ade Ventures", activeWeeks: [0], signIn: "credential" },
  { person: "Gus Lind", signedUp: 5, workspace: "Lind Robotics", agents: [["sample-cursor", "write"], ["sample-claude-code", "write"]], activeWeeks: [0, 1, 2, 3, 4, 5], decisions: 5, signIn: "github" },
  { person: "Hana Sato", signedUp: 4, workspace: "Sato Clinic", agents: [["sample-claude-code", "read"]], activeWeeks: [0, 1], decisions: 0, signIn: "google" },
  { person: "Ivo Petrov", signedUp: 3, workspace: "Petrov & Co", agents: [["sample-vscode", "write"]], activeWeeks: [0, 1, 2, 3], decisions: 3, signIn: "github" },
  { person: "Jia Wen", signedUp: 2, signIn: "google" },
  { person: "Kai Moana", signedUp: 1, workspace: "Moana Surf", agents: [["sample-claude-code", "write"]], activeWeeks: [0, 1], decisions: 2, signIn: "credential" },
  { person: "Lea Roth", signedUp: 0, workspace: "Roth Atelier", agents: [["sample-cursor", "write"]], activeWeeks: [0], decisions: 1, signIn: "github" },
];

const TOOLS = ["list_tasks", "capture_tasks", "claim_task", "complete_task", "request_input", "collect_answers", "get_task", "whoami", "hand_off_task", "remember"];

/** A small seeded generator, so every run draws the same history. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Creates the sample customers that do not exist yet; returns how many it added. */
export async function seedSampleCustomers(db: Db, now = new Date()): Promise<number> {
  const today = startOfUtcDay(now);
  const emails = CUSTOMERS.map((customer) => `${slugOf(customer.person)}@customers.phean.dev`);
  const existing = new Set((await db.select({ email: user.email }).from(user).where(inArray(user.email, emails))).map((row) => row.email));

  for (const client of CLIENTS) {
    const [found] = await db.select({ id: oauthClient.id }).from(oauthClient).where(eq(oauthClient.clientId, client.clientId));
    if (!found) await db.insert(oauthClient).values({ id: randomUUID(), clientId: client.clientId, name: client.name, redirectUris: ["http://127.0.0.1/callback"], createdAt: now, updatedAt: now });
  }

  let added = 0;
  for (const [index, customer] of CUSTOMERS.entries()) {
    const email = emails[index]!;
    if (existing.has(email)) continue;
    added += 1;
    const draw = random(index + 7);
    // Nothing is dated after now: a sample happening "later today" happens a little before now instead.
    const notAfter = (moment: Date, before = 60_000) => (moment.getTime() > now.getTime() - before ? new Date(now.getTime() - before) : moment);
    const signedUpAt = notAfter(new Date(addDays(today, -customer.signedUp * 7 - Math.floor(draw() * 3)).getTime() + 9 * 3_600_000 + Math.floor(draw() * 8) * 3_600_000), 3_600_000);
    const at = (days: number, hours = 0) => notAfter(new Date(signedUpAt.getTime() + days * DAY_MS + hours * 3_600_000));
    const person = { id: randomUUID(), name: customer.person, email };
    await db.insert(user).values({ ...person, emailVerified: customer.signIn !== "credential", createdAt: signedUpAt, updatedAt: signedUpAt, twoFactorEnabled: index % 4 === 2 });
    await db.insert(account).values({ id: randomUUID(), accountId: customer.signIn === "credential" ? person.id : `sample-${index}`, providerId: customer.signIn, userId: person.id, createdAt: signedUpAt, updatedAt: signedUpAt });
    if (!customer.workspace) continue;

    const tenant = { id: randomUUID(), name: customer.workspace, slug: slugOf(customer.workspace) };
    const createdAt = at(0, 0.2);
    await db.insert(organization).values({ ...tenant, createdAt });
    await db.insert(member).values({ id: randomUUID(), organizationId: tenant.id, userId: person.id, role: "owner", createdAt });

    const agentRows = (customer.agents ?? []).map(([client, level], agentIndex) => ({
      id: newId("ag"),
      tenantId: tenant.id,
      name: client === "key" ? "Ops bot" : `${CLIENTS.find((candidate) => candidate.clientId === client)!.name.split(" ")[0]} ${agentIndex + 1}`,
      authKind: client === "key" ? ("key" as const) : ("oauth" as const),
      tokenHash: client === "key" ? `sample:${randomUUID()}` : null,
      accessLevel: level,
      accessExpiresAt: client === "key" ? null : addDays(today, 60),
      oauthClientId: client === "key" ? null : client,
      createdByUserId: person.id,
      createdAt: at(0, 0.5 + agentIndex),
      lastSeenAt: customer.activeWeeks?.includes(customer.signedUp) ? at(customer.signedUp * 7) : at(Math.max(...(customer.activeWeeks ?? [0])) * 7 + 2),
    }));
    if (agentRows.length) await db.insert(agents).values(agentRows);
    const lead = agentRows[0];
    const log: (typeof events.$inferInsert)[] = [];
    const ownerActor = { actorType: "user" as const, actorId: person.id, actorName: person.name };
    for (const agent of agentRows) {
      log.push({ tenantId: tenant.id, ...ownerActor, action: "agent.created", entityType: "agent", entityId: agent.id, summary: `connected ${agent.name}`, data: {}, createdAt: agent.createdAt });
    }

    if (customer.failingWebhook && lead) {
      await db.insert(webhooks).values({
        id: newId("wh"),
        tenantId: tenant.id,
        agentId: lead.id,
        url: "https://hooks.example.com/phean/sample",
        secretCiphertext: encryptSecret(newWebhookSecret()),
        topics: ["decisions", "tasks"],
        consecutiveFailures: 5,
        lastFailureAt: at(customer.signedUp * 7),
        lastStatus: 502,
      });
    }

    const taskRows: (typeof tasks.$inferInsert)[] = [];
    const calls: (typeof toolCallsDaily.$inferInsert)[] = [];
    for (const week of customer.activeWeeks ?? []) {
      if (week > customer.signedUp) continue;
      const days = week * 7;
      // The owner acts in that week, so they count as active.
      log.push({ tenantId: tenant.id, ...ownerActor, action: "task.captured", entityType: "task", entityId: newId("t"), summary: "added a task by hand", data: { source: "manual" }, createdAt: at(days + 1, 1) });
      if (!lead) continue;
      for (const agent of agentRows) {
        for (let call = 0; call < 3; call += 1) {
          const day = isoDate(at(days + call * 2, 2));
          const tool = TOOLS[Math.floor(draw() * TOOLS.length)]!;
          const existingCall = calls.find((row) => row.day === day && row.agentId === agent.id && row.tool === tool);
          const count = 3 + Math.floor(draw() * 20);
          const errors = draw() < 0.15 ? 1 : 0;
          if (existingCall) {
            existingCall.calls = (existingCall.calls ?? 0) + count;
            existingCall.errors = (existingCall.errors ?? 0) + errors;
          } else calls.push({ day, tenantId: tenant.id, agentId: agent.id, tool, calls: count, errors });
        }
      }
      const agentActor = { actorType: "agent" as const, actorId: lead.id, actorName: lead.name };
      for (let decision = 0; decision < (customer.decisions ?? 0); decision += 1) {
        const taskId = newId("t");
        const asked = at(days + decision, 3);
        const answered = new Date(asked.getTime() + (20 + Math.floor(draw() * 600)) * 60_000);
        const request: InputRequest = {
          id: newId("q"),
          kind: "decision",
          question: `Sample decision ${week}.${decision + 1} for ${tenant.name}?`,
          context: "",
          options: ["Yes", "No"],
          links: [],
          agentId: lead.id,
          agentName: lead.name,
          askedAt: asked.toISOString(),
        };
        // An answer that would come after now has not come yet: the request stays open.
        const closed = answered.getTime() <= now.getTime() - 60_000;
        const status: TaskStatus = closed ? "done" : "in_progress";
        const answer: InputAnswer = { ...request, outcome: "answered", answer: "Yes", answeredByName: person.name, answeredByUserId: person.id, closedAt: answered.toISOString(), collected: true };
        taskRows.push({
          id: taskId,
          tenantId: tenant.id,
          title: `Sample work ${week}.${decision + 1}`,
          status,
          source: "email",
          createdByType: "agent",
          createdById: lead.id,
          createdByName: lead.name,
          inputRequest: closed ? null : request,
          inputAnswers: closed ? [answer] : [],
          completedAt: closed ? answered : null,
          createdAt: asked,
          updatedAt: closed ? answered : asked,
        });
        log.push(
          { tenantId: tenant.id, ...agentActor, action: "task.captured", entityType: "task", entityId: taskId, summary: "captured sample work", data: { source: "email" }, createdAt: asked },
          { tenantId: tenant.id, ...agentActor, action: "task.input_requested", entityType: "task", entityId: taskId, summary: "asked for a decision", data: { requestId: request.id, kind: "decision" }, createdAt: asked },
        );
        if (closed) {
          log.push(
            { tenantId: tenant.id, ...ownerActor, action: "task.input_answered", entityType: "task", entityId: taskId, summary: "answered", data: { requestId: request.id, kind: "decision" }, createdAt: answered },
            { tenantId: tenant.id, ...agentActor, action: "task.completed", entityType: "task", entityId: taskId, summary: "completed sample work", data: {}, createdAt: notAfter(new Date(answered.getTime() + 60_000), 1_000) },
          );
        }
        if (decision === 0 && agentRows[1]) {
          log.push({ tenantId: tenant.id, ...agentActor, action: "task.handed_off", entityType: "task", entityId: taskId, summary: "handed off", data: {}, createdAt: notAfter(new Date(asked.getTime() + 30_000), 1_000) });
        }
      }
    }
    if (customer.stuckDays && lead) {
      const asked = new Date(now.getTime() - customer.stuckDays * DAY_MS);
      taskRows.push({
        id: newId("t"),
        tenantId: tenant.id,
        title: "Sample decision still waiting",
        status: "in_progress",
        source: "chat",
        createdByType: "agent",
        createdById: lead.id,
        createdByName: lead.name,
        inputRequest: { id: newId("q"), kind: "question", question: "Which supplier should we keep?", context: "", options: [], links: [], agentId: lead.id, agentName: lead.name, askedAt: asked.toISOString() },
        createdAt: asked,
        updatedAt: asked,
      });
    }
    if (taskRows.length) await db.insert(tasks).values(taskRows);
    if (calls.length) await db.insert(toolCallsDaily).values(calls);
    if (log.length) await db.insert(events).values(log);
  }
  return added;
}
