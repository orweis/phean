import { CheckCheck, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DigestForm } from "@/components/digest-form";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { Card, CardBody, CardHeader, type PanelTone } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { pluralize, timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { emailConfig } from "@/server/config";
import { getDigest, getDigestSubscription, type DigestSection } from "@/server/domain/digest";
import { can } from "@/server/domain/policy";

import { stopDigestAction } from "../actions";

export const metadata: Metadata = { title: "Morning digest" };

/** One section of the digest, in the tone of what it holds, with a way to the rest when it lists only the first few. */
function Section({ title, tone, section, more }: { title: string; tone: PanelTone; section: DigestSection; more: { href: string; label: string } }) {
  if (!section.count) return null;
  return (
    <Card tone={tone}>
      <CardHeader tone={tone} title={`${title} (${section.count})`} divided />
      <CardBody className="py-1">
        <ul>
          {section.items.map((item) => (
            <li key={`${item.href}:${item.title}`} className="border-b border-rule py-3 last:border-b-0">
              <Link href={item.href} scroll={false} className="text-sm font-semibold text-ink hover:underline">
                {item.title}
              </Link>
              <p className="mt-0.5 text-xs text-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
        {section.count > section.items.length && (
          <p className="border-t border-rule py-3 text-xs">
            <Link href={more.href} className="font-semibold link">
              {more.label}
            </Link>
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The morning digest: what waits on the person, what is late, and what the agents finished in the
 * last day, as the email sends it. Beside it, whether and when it is emailed.
 */
export default async function DigestPage({ params }: PageProps<"/w/[slug]/digest">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const subscribes = can(ctx.actor, "digest:subscribe");
  const [digest, subscription] = await Promise.all([getDigest(ctx, {}), subscribes ? getDigestSubscription(ctx, {}) : null]);
  const email = emailConfig();

  return (
    <>
      <PageHeader
        title="Morning digest"
        description="What waits on you, what is late, and what the agents finished in the last 24 hours, in one place. Have it emailed each morning at an hour you choose, with every line a link back here."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <p className="text-sm text-ink-2">
            {digest.captured ? `${pluralize(digest.captured, "task")} came in since ${timeAgo(digest.since)}.` : `Nothing new came in since ${timeAgo(digest.since)}.`}
          </p>
          {digest.quiet ? (
            <Card>
              <CardBody>
                <EmptyState icon={<CheckCheck />} title="A quiet morning">
                  Nothing waits on you, nothing is late, and nothing was finished in the last day.
                </EmptyState>
              </CardBody>
            </Card>
          ) : (
            <>
              <Section title="Waiting on you" tone="wait" section={digest.waiting} more={{ href: routes.decisions(slug), label: "See them all on Decisions" }} />
              <Section title="Late" tone="late" section={digest.late} more={{ href: routes.board(slug), label: "See them all on the board" }} />
              <Section title="Done in the last day" tone="plain" section={digest.finished} more={{ href: routes.timeline(slug), label: "See the timeline" }} />
            </>
          )}
        </div>

        {subscribes && (
          <Card className="self-start">
            <CardHeader title="Email it to me" divided />
            <CardBody className="space-y-3">
              {!email ? (
                <p className="text-sm text-ink-2">
                  This deployment does not send email yet. Whoever runs it sets <code className="font-mono text-xs">RESEND_API_KEY</code> and{" "}
                  <code className="font-mono text-xs">PHEAN_EMAIL_FROM</code>; see{" "}
                  <a href={`${routes.docs("self-hosting")}#email`} className="link">
                    Self-hosting
                  </a>
                  .
                </p>
              ) : subscription ? (
                <>
                  <p className="flex items-start gap-2 text-sm text-ink-2">
                    <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                    <span>
                      Emailed each morning at {String(subscription.hour).padStart(2, "0")}:00, {subscription.timeZone.replaceAll("_", " ")} time
                      {subscription.lastSentAt ? `; last sent ${timeAgo(subscription.lastSentAt)}` : ""}. A morning with nothing to report sends nothing.
                    </span>
                  </p>
                  <DigestForm slug={slug} hour={subscription.hour} timeZone={subscription.timeZone} />
                  <ActionButton
                    action={stopDigestAction}
                    workspace={slug}
                    fields={{}}
                    variant="ghost"
                    size="sm"
                    notice="Stopped your morning digest"
                  >
                    Stop emailing it
                  </ActionButton>
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-2">One email a morning for this workspace. A morning with nothing to report sends nothing.</p>
                  <DigestForm slug={slug} />
                </>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
