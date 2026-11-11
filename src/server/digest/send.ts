import { and, eq, isNull, lt, or } from "drizzle-orm";

import { toMemberRole } from "@/lib/domain";

import { appUrl } from "../config";
import type { Db } from "../db/client";
import { digestSubscriptions, member, organization, user } from "../db/schema";
import { getDigest } from "../domain/digest";
import { userContext } from "../domain/tenants";
import { sendEmail, type SendEmail } from "./email";
import { renderDigestEmail } from "./render";

/** A morning is sent at most once: a row sent less than this long ago is not due again. */
const RESEND_AFTER_MS = 20 * 60 * 60 * 1000;

/** The hour (0 to 23) it is now in `timeZone`. */
export function hourIn(timeZone: string, now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
}

export interface DigestRunReport {
  /** Subscriptions whose hour it is and that have not had today's digest. */
  due: number;
  sent: number;
  /** Due, but nothing waited, was late or happened, so no email went out. */
  quiet: number;
  failed: number;
}

/**
 * Emails every digest whose hour it is in its person's time zone. Each subscription is claimed by
 * moving its `lastSentAt` before anything is sent, so overlapping runs never send one morning twice;
 * a failed send gives the claim back. Only people still in the workspace get one.
 */
export async function sendDueDigests(db: Db, { now = new Date(), send = sendEmail, baseUrl = appUrl() }: { now?: Date; send?: SendEmail; baseUrl?: string } = {}): Promise<DigestRunReport> {
  const rows = await db
    .select({
      tenant: { id: organization.id, slug: organization.slug, name: organization.name },
      userId: digestSubscriptions.userId,
      hour: digestSubscriptions.hour,
      timeZone: digestSubscriptions.timeZone,
      lastSentAt: digestSubscriptions.lastSentAt,
      name: user.name,
      email: user.email,
      role: member.role,
    })
    .from(digestSubscriptions)
    .innerJoin(organization, eq(organization.id, digestSubscriptions.tenantId))
    .innerJoin(user, eq(user.id, digestSubscriptions.userId))
    .innerJoin(member, and(eq(member.organizationId, digestSubscriptions.tenantId), eq(member.userId, digestSubscriptions.userId)));

  const cutoff = new Date(now.getTime() - RESEND_AFTER_MS);
  const due = rows.filter((row) => hourIn(row.timeZone, now) === row.hour && (!row.lastSentAt || row.lastSentAt < cutoff));
  const report: DigestRunReport = { due: due.length, sent: 0, quiet: 0, failed: 0 };

  for (const row of due) {
    const mine = and(eq(digestSubscriptions.tenantId, row.tenant.id), eq(digestSubscriptions.userId, row.userId));
    const [claimed] = await db
      .update(digestSubscriptions)
      .set({ lastSentAt: now })
      .where(and(mine, or(isNull(digestSubscriptions.lastSentAt), lt(digestSubscriptions.lastSentAt, cutoff))))
      .returning({ userId: digestSubscriptions.userId });
    if (!claimed) continue;
    try {
      const ctx = userContext(db, { tenant: row.tenant, role: toMemberRole(row.role) }, { id: row.userId, name: row.name });
      const digest = await getDigest(ctx, { since: row.lastSentAt?.toISOString() });
      if (digest.quiet) {
        report.quiet += 1;
        continue;
      }
      await send(renderDigestEmail(digest, baseUrl, row.email));
      report.sent += 1;
    } catch (error) {
      console.error("[digest] could not send", row.tenant.slug, error);
      report.failed += 1;
      // Give the claim back, so the morning is not marked as sent.
      await db.update(digestSubscriptions).set({ lastSentAt: row.lastSentAt }).where(and(mine, eq(digestSubscriptions.lastSentAt, now)));
    }
  }
  return report;
}
