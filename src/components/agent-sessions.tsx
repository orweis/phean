import { ArrowUpRight, Bot, History, MessageCircleQuestionMark } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { resumeLabel, webUrl, type AgentSession, type InputRequest } from "@/lib/agent-sessions";
import { cx } from "@/lib/cx";
import { timeAgo, truncate } from "@/lib/format";
import { routes } from "@/lib/routes";

import { Badge } from "./ui/badge";
import { buttonClasses, type ButtonVariant } from "./ui/button";
import { CopyButton } from "./ui/copy-button";
import { Popover } from "./ui/popover";

const REFERENCES = [
  { key: "sessionId", label: "Session", subject: "session id" },
  { key: "messageId", label: "Message", subject: "message id" },
  { key: "command", label: "Command", subject: "resume command" },
] as const;

/** An outside link: web links open in a new tab, app links (cursor://, slack://) in their app. */
export function OutsideLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const web = webUrl(href) !== null;
  return (
    <a href={href} className={className} rel="noopener noreferrer" {...(web && { target: "_blank" })}>
      {children}
      <ArrowUpRight aria-hidden />
      {web && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
}

/** The one-click way back into an agent's session, when it gave a link. */
export function ResumeLink({ session, variant = "secondary" }: { session: AgentSession; variant?: ButtonVariant }) {
  if (!session.url) return null;
  return (
    <OutsideLink href={session.url} className={buttonClasses(variant, "sm")}>
      {resumeLabel(session)}
    </OutsideLink>
  );
}

function SessionEntry({ session }: { session: AgentSession }) {
  const references = REFERENCES.flatMap(({ key, ...reference }) => (session[key] ? [{ ...reference, value: session[key] }] : []));
  return (
    <li className="space-y-2 border-b border-rule pb-3 last:border-b-0 last:pb-0">
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
        <Bot className="size-3" aria-hidden />
        <span className="font-semibold text-ink">{session.agentName}</span>
        {session.app && <span>in {session.app}</span>}
        <span aria-hidden>·</span>
        <time dateTime={session.linkedAt}>{timeAgo(session.linkedAt)}</time>
      </p>
      {session.brief && <p className="text-sm text-ink-2">{session.brief}</p>}
      <ResumeLink session={session} variant="tinted" />
      {references.length > 0 && (
        <dl className="space-y-1">
          {references.map(({ label, subject, value }) => (
            <div key={label} className="flex items-center gap-2">
              <dt className="w-16 shrink-0 text-xs text-muted">{label}</dt>
              <dd className="flex min-w-0 flex-1 items-center gap-1">
                <code title={value} className="min-w-0 flex-1 truncate rounded-sm bg-fill px-1.5 py-1 font-mono text-xs text-ink">
                  {value}
                </code>
                <CopyButton value={value} subject={subject} variant="ghost" />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/** Every agent's place to resume a task: its link, its ids and command to copy, and its brief. */
export function ResumePopover({ sessions }: { sessions: readonly AgentSession[] }) {
  if (sessions.length === 0) return null;
  return (
    // Narrower than the default panel at xl, so it opens inside the first of four board lanes.
    <Popover label="Resume" icon={<History aria-hidden />} look="link" className="xl:w-72">
      <p className="mb-3 text-xs font-semibold text-ink-2">Pick up where {sessions.length === 1 ? sessions[0]!.agentName : "an agent"} left off</p>
      <ul className="space-y-3">
        {sessions.map((session) => (
          <SessionEntry key={session.agentId} session={session} />
        ))}
      </ul>
    </Popover>
  );
}

/** Marks a task an agent is waiting on, linking to where its question can be answered. */
export function WaitingBadge({ slug }: { slug: string }) {
  return (
    <Link href={routes.questions(slug)} className="rounded-full">
      <Badge tone="warning">
        <MessageCircleQuestionMark aria-hidden />
        Waiting on you
      </Badge>
    </Link>
  );
}

/**
 * The question on a task's card, cut to about three lines of the narrowest board lane; the clamp
 * catches a long agent name. The overview shows it whole.
 */
export function QuestionNote({ request, className }: { request: InputRequest; className?: string }) {
  return (
    <div className={cx("rounded-md bg-wait-tint px-2.5 py-1.5 text-xs text-wait-ink", className)}>
      <p className="line-clamp-3">
        <span className="font-semibold">{request.agentName} asks:</span> {truncate(request.question, 90)}
      </p>
    </div>
  );
}
