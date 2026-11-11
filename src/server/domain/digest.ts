import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { askerName } from "@/lib/agent-sessions";
import { formatDueDate, pluralize, relativeDue } from "@/lib/format";
import { routes } from "@/lib/routes";

import { digestSubscriptions, events, goals, tasks } from "../db/schema";
import { inTenant, type Ctx, type Tenant } from "./context";
import { forbidden } from "./errors";
import { assertCan } from "./policy";
import { DigestInput, Empty, SaveDigestInput } from "./schemas";
import { service } from "./service";
import { isAwaitingInput, isOverdue, selectTaskViews } from "./tasks";

/** One line of a digest: what it is, a few words of why, and where it leads (a path in the app). */
export interface DigestItem {
  title: string;
  detail: string;
  href: string;
}

export interface DigestSection {
  /** Everything that matches, though only the first few are listed. */
  count: number;
  items: DigestItem[];
}

export interface Digest {
  tenant: Tenant;
  since: Date;
  /** Questions and decisions agents asked, and goals they proposed: what waits on a person. */
  waiting: DigestSection;
  late: DigestSection;
  /** Tasks finished since `since`, newest first. */
  finished: DigestSection;
  /** How many tasks agents and people captured since `since`. */
  captured: number;
  /** Nothing waits, nothing is late, and nothing happened: a digest not worth sending. */
  quiet: boolean;
}

/** How many lines each section lists before "and N more". */
export const DIGEST_ITEMS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A digest looks back at most a week, so a person back from leave gets a summary, not a log. */
const MAX_LOOKBACK_MS = 7 * DAY_MS;

/**
 * The morning digest for the acting person's workspace: what waits on them, what is late, what the
 * agents finished and how much came in since `since`. Every line links back into the app.
 */
export const getDigest = service(DigestInput, async (ctx, input): Promise<Digest> => {
  assertCan(ctx, "workspace:read");
  const now = Date.now();
  const since = new Date(Math.max(input.since ? Date.parse(input.since) : now - DAY_MS, now - MAX_LOOKBACK_MS));
  const slug = ctx.tenant.slug;

  const [asked, proposed, late, finished, [captured]] = await Promise.all([
    selectTaskViews(ctx, isAwaitingInput).orderBy(sql`${tasks.inputRequest}->>'askedAt'`),
    ctx.db
      .select({ id: goals.id, title: goals.title, createdByName: goals.createdByName })
      .from(goals)
      .where(and(inTenant(ctx, goals), eq(goals.status, "proposed")))
      .orderBy(goals.createdAt),
    selectTaskViews(ctx, isOverdue).orderBy(tasks.dueDate),
    selectTaskViews(ctx, and(eq(tasks.status, "done"), gte(tasks.completedAt, since))).orderBy(desc(tasks.completedAt)),
    ctx.db
      .select({ n: count() })
      .from(tasks)
      .where(and(inTenant(ctx, tasks), gte(tasks.createdAt, since))),
  ]);

  // A finished task no longer holds a claim; who finished it is in the event log.
  const finishers = new Map(
    finished.length
      ? (
          await ctx.db
            .select({ taskId: events.entityId, name: events.actorName })
            .from(events)
            .where(and(inTenant(ctx, events), eq(events.action, "task.completed"), inArray(events.entityId, finished.map((task) => task.id))))
            .orderBy(events.id)
        ).map((row) => [row.taskId, row.name])
      : [],
  );

  const waitingItems: DigestItem[] = [
    ...asked.map((task) => ({
      title: task.inputRequest!.question,
      detail: `${askerName(task.inputRequest!)} asked, on “${task.title}”`,
      href: routes.decision(slug, task.id),
    })),
    ...proposed.map((goal) => ({ title: `Approve “${goal.title}”`, detail: `Goal proposed by ${goal.createdByName}`, href: routes.approvals(slug) })),
  ];
  const lateItems = late.map((task) => ({
    title: task.title,
    detail: [`Due ${formatDueDate(task.dueDate!)}, ${relativeDue(task.dueDate!)}`, task.claimedByName && `held by ${task.claimedByName}`].filter(Boolean).join(", "),
    href: routes.task(slug, task.id),
  }));
  const finishedItems = finished.map((task) => ({
    title: task.title,
    detail: [finishers.has(task.id) ? `Done by ${finishers.get(task.id)}` : "Done", task.goalTitle && `for “${task.goalTitle}”`].filter(Boolean).join(" "),
    href: routes.task(slug, task.id),
  }));
  const section = (items: DigestItem[]): DigestSection => ({ count: items.length, items: items.slice(0, DIGEST_ITEMS) });
  const capturedCount = captured?.n ?? 0;

  return {
    tenant: ctx.tenant,
    since,
    waiting: section(waitingItems),
    late: section(lateItems),
    finished: section(finishedItems),
    captured: capturedCount,
    quiet: !waitingItems.length && !lateItems.length && !finishedItems.length && capturedCount === 0,
  };
});

/** The digest's subject line: what waits leads, since that is what the person acts on. */
export function digestSubject(digest: Digest): string {
  const parts = [
    digest.waiting.count && `${pluralize(digest.waiting.count, "thing")} waiting on you`,
    digest.late.count && `${digest.late.count} late`,
    digest.finished.count && `${digest.finished.count} done`,
  ].filter(Boolean);
  return `${digest.tenant.name}: ${parts.length ? parts.join(", ") : "a quiet morning"}`;
}

export interface DigestSubscription {
  hour: number;
  timeZone: string;
  lastSentAt: Date | null;
}

function personOf(ctx: Ctx): string {
  if (ctx.actor.type !== "user") throw forbidden("Only people get a morning digest.");
  return ctx.actor.id;
}

/** The acting person's digest settings for this workspace, or null when they have none. */
export const getDigestSubscription = service(Empty, async (ctx): Promise<DigestSubscription | null> => {
  assertCan(ctx, "digest:subscribe");
  const [row] = await ctx.db
    .select({ hour: digestSubscriptions.hour, timeZone: digestSubscriptions.timeZone, lastSentAt: digestSubscriptions.lastSentAt })
    .from(digestSubscriptions)
    .where(and(inTenant(ctx, digestSubscriptions), eq(digestSubscriptions.userId, personOf(ctx))));
  return row ?? null;
});

/** Emails the acting person this workspace's digest each morning at `hour` in `timeZone`. */
export const saveDigestSubscription = service(SaveDigestInput, async (ctx, { hour, timeZone }): Promise<DigestSubscription> => {
  assertCan(ctx, "digest:subscribe");
  const [row] = await ctx.db
    .insert(digestSubscriptions)
    .values({ tenantId: ctx.tenant.id, userId: personOf(ctx), hour, timeZone })
    .onConflictDoUpdate({ target: [digestSubscriptions.tenantId, digestSubscriptions.userId], set: { hour, timeZone, updatedAt: new Date() } })
    .returning({ hour: digestSubscriptions.hour, timeZone: digestSubscriptions.timeZone, lastSentAt: digestSubscriptions.lastSentAt });
  return row!;
});

/** Stops the acting person's digest for this workspace. */
export const stopDigestSubscription = service(Empty, async (ctx): Promise<void> => {
  assertCan(ctx, "digest:subscribe");
  await ctx.db.delete(digestSubscriptions).where(and(inTenant(ctx, digestSubscriptions), eq(digestSubscriptions.userId, personOf(ctx))));
});
