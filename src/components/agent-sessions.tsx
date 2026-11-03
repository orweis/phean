import { ArrowUpRight, Bot, FileText, History, Link2, MessageCircleQuestionMark, MessagesSquare, Paperclip, Scale } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { resumeLabel, webUrl, type AgentSession, type InputRequest, type LinkKind, type TaskLink } from "@/lib/agent-sessions";
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
      <p className="flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Bot className="size-3" aria-hidden />
          <span className="font-semibold text-ink">{session.agentName}</span>
          {session.app && <span>in {session.app}</span>}
        </span>
        <time dateTime={session.linkedAt}>{timeAgo(session.linkedAt)}</time>
      </p>
      {session.brief && <p className="text-sm text-ink-2">{session.brief}</p>}
      <ResumeLink session={session} variant="tinted" />
      {references.length > 0 && (
        <dl className="space-y-1.5">
          {references.map(({ label, subject, value }) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-0.5 flex min-w-0 items-center gap-1">
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
export function WaitingBadge({ slug, kind = "question" }: { slug: string; kind?: InputRequest["kind"] }) {
  return (
    <Link href={routes.decisions(slug)} className="rounded-full">
      <Badge tone="warning">
        {kind === "decision" ? <Scale aria-hidden /> : <MessageCircleQuestionMark aria-hidden />}
        {kind === "decision" ? "Decision for you" : "Waiting on you"}
      </Badge>
    </Link>
  );
}

const LINK_ICONS: Record<LinkKind, ReactNode> = {
  conversation: <MessagesSquare aria-hidden />,
  source: <Paperclip aria-hidden />,
  doc: <FileText aria-hidden />,
  other: <Link2 aria-hidden />,
};

/** A link's own title, or where it goes when the agent gave none. */
function linkLabel(link: TaskLink): string {
  if (link.title) return link.title;
  try {
    const url = new URL(link.url);
    return url.hostname || url.protocol.replace(/:$/, "");
  } catch {
    return link.url;
  }
}

/**
 * References an agent left: back to the conversation, to the source message, to docs. Each opens
 * outside Phean; the kind sets its icon so the way back to the conversation stands out.
 */
export function TaskLinks({ links, className }: { links: readonly TaskLink[]; className?: string }) {
  if (links.length === 0) return null;
  return (
    <ul aria-label="Links" className={cx("flex flex-wrap gap-1.5", className)}>
      {links.map((link) => (
        <li key={`${link.kind}:${link.url}`} className="min-w-0 max-w-full">
          <OutsideLink
            href={link.url}
            className={cx(
              "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold hover:border-ink-2 [&_svg]:size-3 [&_svg]:shrink-0",
              link.kind === "conversation" ? "border-accent/40 text-accent-ink" : "border-rule text-ink-2",
            )}
          >
            {LINK_ICONS[link.kind]}
            <span className="truncate" title={link.url}>
              {linkLabel(link)}
            </span>
          </OutsideLink>
        </li>
      ))}
    </ul>
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
        <span className="font-semibold">{request.agentName} {request.kind === "decision" ? "needs a decision:" : "asks:"}</span>{" "}
        {truncate(request.question, 90)}
      </p>
    </div>
  );
}
