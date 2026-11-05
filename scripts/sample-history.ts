/**
 * Three weeks of backdated sample work for one demo workspace, so the timeline, the flow chart
 * and the goal map have history to draw. Rows and events are written directly with explicit
 * timestamps; the services would stamp everything "now". Runs only on a workspace with no tasks.
 */
import { createHash } from "node:crypto";

import { count, eq } from "drizzle-orm";

import type { AgentSession, TaskLink } from "../src/lib/agent-sessions";
import { addDays, isoDayFromToday, startOfUtcDay } from "../src/lib/dates";
import { SOURCE_META, TASK_STATUS_META, type GoalStatus, type Priority, type Source, type TaskStatus } from "../src/lib/domain";
import { truncate } from "../src/lib/format";
import type { Db } from "../src/server/db/client";
import { newId } from "../src/server/db/ids";
import { documentFileName } from "../src/lib/documents";
import { routes } from "../src/lib/routes";
import { appUrl } from "../src/server/config";
import { agents, documents, events, goals, memories, tasks, webhooks } from "../src/server/db/schema";
import { blobStore, documentKey } from "../src/server/storage/blobs";
import { generateAgentToken } from "../src/server/domain/agents";
import { encryptSecret, newWebhookSecret } from "../src/server/webhooks/signing";
import type { Tenant } from "../src/server/domain/context";

type AgentKey = "sweeper" | "planner" | "clerk";
type GoalKey = "portal" | "docs" | "billing" | "books" | "hire" | "crm" | "lease";
/** A status and the number of days ago the task entered it. */
type Leg = [TaskStatus, number];

interface SampleTask {
  title: string;
  goal?: GoalKey;
  source: Source;
  priority?: Priority;
  /** Days from today; negative is in the past. */
  due?: number;
  legs: Leg[];
  /** Who claims and completes it. */
  agent: AgentKey;
  /** A link to the source message; other samples get an opaque reference. */
  ref?: string;
}

const AGENTS: Record<AgentKey, { name: string; seenHoursAgo: number }> = {
  sweeper: { name: "Inbox sweeper", seenHoursAgo: 1 },
  planner: { name: "Calendar planner", seenHoursAgo: 3 },
  clerk: { name: "Finance clerk", seenHoursAgo: 30 },
};

const GOALS: Record<GoalKey, { title: string; parent?: GoalKey; status: GoalStatus; createdDaysAgo: number; proposedBy?: AgentKey; description: string }> = {
  portal: { title: "Launch the partner portal", status: "active", createdDaysAgo: 21, description: "Partners sign up, read the docs, and get paid without emailing us." },
  docs: { title: "Partner onboarding docs", parent: "portal", status: "active", createdDaysAgo: 18, description: "" },
  billing: { title: "Billing integration", parent: "portal", status: "active", createdDaysAgo: 16, description: "" },
  books: { title: "Close the Q4 books", status: "active", createdDaysAgo: 20, description: "Everything the auditor asks for in January, ready in December." },
  hire: { title: "Hire a support lead", status: "active", createdDaysAgo: 14, description: "" },
  crm: { title: "Migrate the CRM", status: "achieved", createdDaysAgo: 22, description: "" },
  lease: { title: "Renew the office lease", status: "proposed", createdDaysAgo: 2, proposedBy: "sweeper", description: "The lease ends in March; three landlords have sent offers." },
};

const TASKS: SampleTask[] = [
  { title: "Write the partner API quickstart", goal: "docs", source: "slack", due: -8, legs: [["inbox", 18], ["todo", 17], ["in_progress", 12], ["done", 6]], agent: "sweeper" },
  { title: "Record the onboarding walkthrough", goal: "docs", source: "manual", due: 2, legs: [["todo", 15], ["in_progress", 4]], agent: "planner" },
  { title: "Translate the docs into German", goal: "docs", source: "email", legs: [["inbox", 10], ["todo", 9], ["dropped", 5]], agent: "sweeper" },
  { title: "Collect partner logos", goal: "portal", source: "email", legs: [["inbox", 12], ["todo", 11], ["done", 9]], agent: "sweeper" },
  { title: "Set up the partner Slack channel", goal: "portal", source: "slack", legs: [["inbox", 20], ["todo", 20], ["in_progress", 19], ["done", 18]], agent: "sweeper" },
  { title: "Review the partner agreement with legal", goal: "portal", source: "email", priority: "high", due: 6, legs: [["inbox", 3]], agent: "sweeper" },
  { title: "Map Stripe products to partner tiers", goal: "billing", source: "manual", due: -1, legs: [["todo", 16], ["in_progress", 9], ["todo", 7], ["in_progress", 3]], agent: "clerk" },
  { title: "Test the invoice webhooks", goal: "billing", source: "slack", due: -2, legs: [["inbox", 9], ["todo", 8], ["in_progress", 6], ["done", 1]], agent: "clerk" },
  { title: "Draft the revenue share terms", goal: "billing", source: "email", due: 4, legs: [["inbox", 6], ["todo", 5]], agent: "clerk" },
  { title: "Reconcile November card spend", goal: "books", source: "email", due: -6, legs: [["inbox", 14], ["todo", 13], ["in_progress", 10], ["done", 7]], agent: "clerk" },
  { title: "Chase three overdue invoices", goal: "books", source: "email", priority: "urgent", due: -2, legs: [["inbox", 11], ["todo", 10], ["in_progress", 2]], agent: "clerk" },
  { title: "Accrue December payroll", goal: "books", source: "manual", due: 3, legs: [["todo", 9], ["in_progress", 1]], agent: "clerk" },
  { title: "Send W-9 requests to new vendors", goal: "books", source: "email", legs: [["inbox", 13], ["todo", 12], ["done", 11]], agent: "clerk" },
  { title: "Book the auditor kickoff", goal: "books", source: "calendar", due: 1, legs: [["inbox", 5], ["todo", 4]], agent: "planner" },
  { title: "Clear the expense backlog", goal: "books", source: "slack", legs: [["inbox", 19], ["todo", 17], ["in_progress", 15], ["done", 12]], agent: "clerk" },
  { title: "Prepare the board deck numbers", goal: "books", source: "manual", priority: "high", due: 5, legs: [["todo", 2]], agent: "clerk" },
  { title: "Write the job description", goal: "hire", source: "manual", legs: [["todo", 14], ["in_progress", 13], ["done", 11]], agent: "sweeper" },
  { title: "Post the role on three job boards", goal: "hire", source: "manual", legs: [["todo", 11], ["in_progress", 10], ["done", 9]], agent: "sweeper" },
  { title: "Screen the first twenty applicants", goal: "hire", source: "email", due: 1, legs: [["inbox", 8], ["todo", 8], ["in_progress", 5]], agent: "sweeper" },
  { title: "Schedule the panel interviews", goal: "hire", source: "calendar", due: 4, legs: [["inbox", 4], ["todo", 3]], agent: "planner" },
  { title: "Prepare the take-home exercise", goal: "hire", source: "slack", legs: [["inbox", 7], ["todo", 6], ["dropped", 3]], agent: "sweeper" },
  { title: "Export contacts from the old CRM", goal: "crm", source: "manual", legs: [["todo", 21], ["in_progress", 20], ["done", 17]], agent: "sweeper" },
  { title: "Deduplicate company records", goal: "crm", source: "manual", legs: [["todo", 19], ["in_progress", 16], ["done", 12]], agent: "sweeper" },
  { title: "Retire the old CRM logins", goal: "crm", source: "email", legs: [["inbox", 9], ["todo", 8], ["done", 4]], agent: "sweeper" },
  { title: "Compare the three lease offers", goal: "lease", source: "email", due: 9, legs: [["inbox", 2]], agent: "sweeper" },
  { title: "Reply to the conference sponsorship email", source: "email", legs: [["inbox", 2]], agent: "sweeper" },
  { title: "Evaluate a second payroll provider", goal: "books", source: "email", legs: [["inbox", 8], ["backlog", 7]], agent: "clerk" },
  { title: "Renew the SSL certificate", source: "email", priority: "high", due: 3, legs: [["inbox", 1]], agent: "sweeper", ref: "https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKkmPqRtVbHnLcZxTwMvB" },
  { title: "Read the Slack thread about on-call pay", source: "slack", legs: [["inbox", 0]], agent: "sweeper", ref: "https://globex.slack.com/archives/C02ONCALL/p1730900000000100" },
  { title: "Update the office Wi-Fi password", source: "slack", legs: [["inbox", 6], ["todo", 5], ["done", 5]], agent: "planner" },
];

/** Documents agents attached: the draft behind the Globex decision, and the plan for the Q4 close. */
const DOCUMENTS: { title: string; summary: string; task?: string; goal?: GoalKey; agent: AgentKey; hoursAgo: number; content: string; linkFrom?: string }[] = [
  {
    title: "Draft reply to Globex",
    summary: "The reply offering 5% on invoice #4471 if Globex pays this week, ready to send once you decide.",
    task: "Chase three overdue invoices",
    linkFrom: "Chase three overdue invoices",
    agent: "clerk",
    hoursAgo: 3,
    content: `# Draft reply to Globex

Hi Priya,

Thanks for flagging the late delivery on order **1182**. We would like to make it right: if you settle invoice **#4471** this week, we will take **5% off** ($120).

Best,
Dana

---

## Where the three invoices stand

| Invoice | Customer | Amount | State |
| --- | --- | ---: | --- |
| #4468 | Initech | $1,150 | Paid |
| #4470 | Soylent | $860 | Paid |
| #4471 | Globex | $2,400 | Disputed |

\`\`\`mermaid
flowchart LR
  A[Invoice #4471] --> B{Dana decides}
  B -- Offer 5% --> C[Send this reply]
  B -- Escalate --> D[Email their CFO]
\`\`\`
`,
  },
  {
    title: "Q4 close plan",
    summary: "The order of the close: reconcile, accrue, then the board numbers, with owners.",
    goal: "books",
    agent: "clerk",
    hoursAgo: 30,
    content: `# Q4 close plan

1. Reconcile card spend and bank accounts (Finance clerk)
2. Accrue December payroll (Finance clerk)
3. Book the auditor kickoff (Calendar planner)
4. Prepare the board deck numbers (Dana)

- [x] November card spend reconciled
- [ ] Payroll accrual
- [ ] Board deck
`,
  },
];

/** Where each working agent can be resumed, and the one question waiting on the owner. */
interface Handoff {
  session: Omit<AgentSession, "agentId" | "agentName" | "linkedAt">;
  hoursAgo: number;
  question?: string;
  /** With options, the question is a decision. */
  options?: string[];
  context?: string;
  links?: TaskLink[];
}

const HANDOFFS: Record<string, Handoff> = {
  "Chase three overdue invoices": {
    session: {
      app: "Claude",
      url: "https://claude.ai/chat/5d0c2e7a-91b4-4a8e-b1f3-2c6e8a4d7f10",
      sessionId: null,
      messageId: null,
      command: null,
      brief: "Two of the three are paid. Globex disputes #4471 and wants a discount.",
    },
    hoursAgo: 3,
    question: "Globex disputes invoice #4471 ($2,400) and asks for 10% off. Offer 5% to settle this week, or escalate to their CFO?",
    options: ["Offer 5% this week", "Escalate to their CFO"],
    context: "They have paid on time for two years and the dispute is about a late delivery we caused. I recommend offering 5%: it costs $120 and keeps the account.",
    links: [
      { url: "https://claude.ai/chat/5d0c2e7a-91b4-4a8e-b1f3-2c6e8a4d7f10", title: "This chat", kind: "conversation" },
      { url: "https://mail.google.com/mail/u/0/#inbox/globex-4471", title: "Globex's dispute email", kind: "source" },
    ],
  },
  "Screen the first twenty applicants": {
    session: {
      app: "Claude Code",
      url: null,
      sessionId: "4f1c9e2a-7b3d-4e61-9a0c-d25b8e3f6a17",
      messageId: null,
      command: "claude --resume 4f1c9e2a-7b3d-4e61-9a0c-d25b8e3f6a17",
      brief: "Screened 12 of 20. Four look strong; notes are on each candidate.",
    },
    hoursAgo: 5,
  },
  "Record the onboarding walkthrough": {
    session: {
      app: "Slack",
      url: "https://globex.slack.com/archives/C07ONBOARD/p1730812345000200",
      sessionId: "C07ONBOARD",
      messageId: "1730812345.000200",
      command: null,
      brief: "The script is approved; recording on Thursday with the partner team.",
    },
    hoursAgo: 20,
  },
};

const MEMORIES: { content: string; goal?: GoalKey; kind: "fact" | "preference" | "decision" }[] = [
  { content: "Partners are paid monthly, net 30, in their own currency.", goal: "billing", kind: "decision" },
  { content: "The auditor wants card statements as PDFs, not CSV exports.", goal: "books", kind: "preference" },
  { content: "Support lead interviews need someone from engineering on every panel.", goal: "hire", kind: "fact" },
];

const HOUR_MS = 3_600_000;

export async function seedSampleHistory(db: Db, tenant: Tenant, owner: { id: string; name: string }): Promise<number> {
  const [{ total }] = (await db.select({ total: count() }).from(tasks).where(eq(tasks.tenantId, tenant.id))) as [{ total: number }];
  if (total > 0) return 0;

  const now = new Date();
  const today = startOfUtcDay(now);
  /** Office hours on a past day, never later than a few minutes ago. */
  const at = (daysAgo: number, hour: number) => new Date(Math.min(addDays(today, -daysAgo).getTime() + hour * HOUR_MS, now.getTime() - 5 * 60_000));
  const human = { actorType: "user" as const, actorId: owner.id, actorName: owner.name };

  const agentIds = {} as Record<AgentKey, string>;
  for (const [key, { name, seenHoursAgo }] of Object.entries(AGENTS) as [AgentKey, (typeof AGENTS)[AgentKey]][]) {
    const { tokenHash, tokenPrefix } = generateAgentToken();
    agentIds[key] = newId("ag");
    await db.insert(agents).values({
      id: agentIds[key],
      tenantId: tenant.id,
      name,
      tokenHash,
      tokenPrefix,
      createdByUserId: owner.id,
      createdAt: at(22, 8),
      lastSeenAt: new Date(now.getTime() - seenHoursAgo * HOUR_MS),
    });
  }
  // The finance clerk runs as a service and is told about decisions by webhook; its endpoint is
  // fictional, so the seed parks it in backoff rather than have a dev server call it.
  await db.insert(webhooks).values({
    id: newId("wh"),
    tenantId: tenant.id,
    agentId: agentIds.clerk,
    url: "https://bots.globex.example/phean/finance-clerk",
    secretCiphertext: encryptSecret(newWebhookSecret()),
    topics: ["decisions", "tasks"],
    scope: "related",
    nextAttemptAt: new Date(now.getTime() + 24 * HOUR_MS),
    lastSuccessAt: new Date(now.getTime() - 26 * HOUR_MS),
  });
  const asAgent = (key: AgentKey) => ({ actorType: "agent" as const, actorId: agentIds[key], actorName: AGENTS[key].name });

  const log: (typeof events.$inferInsert)[] = [];
  const goalIds = {} as Record<GoalKey, string>;
  for (const [key, goal] of Object.entries(GOALS) as [GoalKey, (typeof GOALS)[GoalKey]][]) {
    goalIds[key] = newId("g");
    const createdAt = at(goal.createdDaysAgo, 9);
    const author = goal.proposedBy ? { type: "agent" as const, id: agentIds[goal.proposedBy], name: AGENTS[goal.proposedBy].name } : { type: "user" as const, id: owner.id, name: owner.name };
    const approved = goal.status !== "proposed";
    await db.insert(goals).values({
      id: goalIds[key],
      tenantId: tenant.id,
      parentId: goal.parent ? goalIds[goal.parent] : null,
      title: goal.title,
      description: goal.description,
      status: goal.status,
      approvedById: approved ? owner.id : null,
      approvedByName: approved ? owner.name : null,
      approvedAt: approved ? createdAt : null,
      createdByType: author.type,
      createdById: author.id,
      createdByName: author.name,
      createdAt,
      updatedAt: goal.status === "achieved" ? at(3, 16) : createdAt,
    });
    const actor = goal.proposedBy ? asAgent(goal.proposedBy) : human;
    log.push({ tenantId: tenant.id, ...actor, action: goal.proposedBy ? "goal.proposed" : "goal.created", entityType: "goal", entityId: goalIds[key], summary: `${goal.proposedBy ? "proposed" : "created"} goal "${goal.title}"`, data: { parentGoalId: goal.parent ? goalIds[goal.parent] : null }, createdAt });
    if (goal.status === "achieved") {
      log.push({ tenantId: tenant.id, ...human, action: "goal.achieved", entityType: "goal", entityId: goalIds[key], summary: `marked achieved goal "${goal.title}"`, data: { from: "active", to: "achieved" }, createdAt: at(3, 16) });
    }
  }

  const taskIds = new Map<string, string>();
  const documentIds = new Map<string, string>();
  for (const doc of DOCUMENTS) documentIds.set(doc.title, newId("d"));
  for (const [index, sample] of TASKS.entries()) {
    const id = newId("t");
    taskIds.set(sample.title, id);
    const draftLinks = DOCUMENTS.filter((doc) => doc.linkFrom === sample.title).map((doc) => ({
      url: new URL(routes.document(tenant.slug, documentIds.get(doc.title)!), appUrl()).href,
      title: doc.title,
      kind: "doc" as const,
    }));
    const goalId = sample.goal ? goalIds[sample.goal] : null;
    const stops = sample.legs.map(([status, daysAgo], leg) => ({ status, at: at(daysAgo, 8 + ((index * 3 + leg * 2) % 9)) }));
    const first = stops[0]!;
    const last = stops.at(-1)!;
    const capturedBy = sample.source === "manual" ? human : asAgent(sample.source === "calendar" ? "planner" : "sweeper");
    const worker = asAgent(sample.agent);
    const handoff = HANDOFFS[sample.title];
    const handedOffAt = handoff && new Date(now.getTime() - handoff.hoursAgo * HOUR_MS);
    const who = { agentId: agentIds[sample.agent], agentName: AGENTS[sample.agent].name };

    await db.insert(tasks).values({
      id,
      tenantId: tenant.id,
      goalId,
      title: sample.title,
      status: last.status,
      priority: sample.priority ?? "medium",
      source: sample.source,
      sourceRef: sample.source === "manual" ? "" : (sample.ref ?? `sample:${index}`),
      dueDate: sample.due === undefined ? null : isoDayFromToday(sample.due, now),
      claimedByAgentId: last.status === "in_progress" ? agentIds[sample.agent] : null,
      claimedAt: last.status === "in_progress" ? last.at : null,
      completedAt: last.status === "done" ? last.at : null,
      agentSessions: handoff ? [{ ...who, ...handoff.session, linkedAt: handedOffAt!.toISOString() }] : [],
      inputRequest: handoff?.question
        ? {
            ...who,
            id: `q_${id.slice(2)}`,
            kind: handoff.options ? "decision" : "question",
            question: handoff.question,
            context: handoff.context ?? "",
            options: handoff.options ?? [],
            links: [...(handoff.links ?? []), ...draftLinks],
            askedAt: handedOffAt!.toISOString(),
          }
        : null,
      createdByType: capturedBy.actorType,
      createdById: capturedBy.actorId,
      createdByName: capturedBy.actorName,
      createdAt: first.at,
      updatedAt: last.at,
    });

    const event = (actor: typeof human | ReturnType<typeof asAgent>, action: string, summary: string, createdAt: Date, data: Record<string, unknown> = {}) =>
      log.push({ tenantId: tenant.id, ...actor, action, entityType: "task", entityId: id, summary, data: { goalId, ...data }, createdAt });

    event(capturedBy, "task.captured", `captured "${sample.title}" from ${SOURCE_META[sample.source].label.toLowerCase()}`, first.at, { source: sample.source, status: first.status });
    for (const [leg, stop] of stops.slice(1).entries()) {
      const from = stops[leg]!.status;
      if (stop.status === "in_progress") event(worker, "task.claimed", `claimed "${sample.title}"`, stop.at);
      else if (stop.status === "done") event(worker, "task.completed", `completed "${sample.title}"`, stop.at, { note: "" });
      else if (from === "in_progress" && stop.status === "todo") event(worker, "task.released", `released "${sample.title}"`, stop.at);
      else if (from === "inbox" && stop.status === "todo" && goalId) event(worker, "task.assigned", `filed "${sample.title}" under "${GOALS[sample.goal!].title}"`, stop.at);
      else event(human, "task.updated", `moved "${sample.title}" to ${TASK_STATUS_META[stop.status].label}`, stop.at, { changed: ["status"], status: stop.status });
    }
    if (handoff) {
      const session = { app: handoff.session.app, url: handoff.session.url, sessionId: handoff.session.sessionId };
      if (handoff.question) {
        event(worker, "task.input_requested", `asked about "${sample.title}": ${truncate(handoff.question, 120)}`, handedOffAt!, { question: handoff.question, session });
      } else {
        event(worker, "task.session_linked", `linked a session to "${sample.title}"`, handedOffAt!, { session });
      }
    }
  }

  for (const [index, memory] of MEMORIES.entries()) {
    const createdAt = at(10 - index * 3, 11);
    await db.insert(memories).values({
      id: newId("m"),
      tenantId: tenant.id,
      kind: memory.kind,
      content: memory.content,
      goalId: memory.goal ? goalIds[memory.goal] : null,
      createdByType: "agent",
      createdById: agentIds.sweeper,
      createdByName: AGENTS.sweeper.name,
      createdAt,
      updatedAt: createdAt,
    });
  }

  const store = blobStore({ db, tenant, actor: { type: "user", id: owner.id, name: owner.name, role: "owner" } });
  for (const doc of DOCUMENTS) {
    const id = documentIds.get(doc.title)!;
    const bytes = new TextEncoder().encode(doc.content);
    const key = documentKey(tenant.id, id, 1);
    const createdAt = new Date(now.getTime() - doc.hoursAgo * HOUR_MS);
    await store.put(key, bytes, "text/markdown; charset=utf-8");
    await db.insert(documents).values({
      id,
      tenantId: tenant.id,
      taskId: doc.task ? taskIds.get(doc.task)! : null,
      goalId: doc.goal ? goalIds[doc.goal] : null,
      title: doc.title,
      format: "markdown",
      summary: doc.summary,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      storageKey: key,
      createdByType: "agent",
      createdById: agentIds[doc.agent],
      createdByName: AGENTS[doc.agent].name,
      updatedByName: AGENTS[doc.agent].name,
      createdAt,
      updatedAt: createdAt,
    });
    log.push({ tenantId: tenant.id, ...asAgent(doc.agent), action: "document.attached", entityType: "document", entityId: id, summary: `attached "${doc.title}" (${documentFileName(doc.title, "markdown")})`, data: { taskId: doc.task ? taskIds.get(doc.task)! : null, goalId: doc.goal ? goalIds[doc.goal] : null, format: "markdown", version: 1 }, createdAt });
  }

  await db.insert(events).values(log);
  return TASKS.length;
}
