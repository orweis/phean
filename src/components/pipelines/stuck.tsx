import { Send, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { resendHandoffAction } from "@/app/w/[slug]/actions";
import { cx } from "@/lib/cx";
import { formatDuration, pluralize } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { StopHandoff } from "@/server/domain/pipelines";

import { ActionButton } from "../ui/action-button";
import { Badge } from "../ui/badge";

/**
 * An agent stop's agent by its name now, linked to its row on the Agents page; the stop's stored
 * text, plainly, when no connected agent goes by it any more.
 */
export function AgentName({ slug, agent, fallback, className, tabIndex }: { slug: string; agent: { id: string; name: string } | null; fallback: string; className?: string; tabIndex?: number }) {
  if (!agent) return <span className={className}>{fallback}</span>;
  return (
    <Link href={routes.agents(slug, { focus: agent.id })} data-agent-link={agent.id} tabIndex={tabIndex} className={cx("link", className)}>
      {agent.name}
    </Link>
  );
}

/** "Stuck": a handoff no one picked up, by icon and word, with since when and how often it was resent. */
export function StuckBadge({ handoff, now }: { handoff: Pick<StopHandoff, "handedOffAt" | "resends" | "gaveUpAt">; now?: Date }) {
  return (
    <span data-stuck className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Badge tone={handoff.gaveUpAt ? "danger" : "warning"}>
        <TriangleAlert aria-hidden />
        {handoff.gaveUpAt ? "Stuck: needs a person" : "Stuck"}
      </Badge>
      {now && (
        <span className="text-xs text-ink-2">
          Not picked up for {formatDuration(now.getTime() - handoff.handedOffAt.getTime())}
          {handoff.resends > 0 && ` · resent ${pluralize(handoff.resends, "time")}`}
          {handoff.gaveUpAt && " · Phean stopped resending"}
        </span>
      )}
    </span>
  );
}

/** Sends an agent stop's handoff again while it still waits on its agent: stuck or not, given up on or not. */
export function ResendHandoffButton({
  slug,
  runId,
  stopId,
  stopName,
  agentName,
  stuck,
}: {
  slug: string;
  runId: string;
  stopId: string;
  stopName: string;
  agentName: string;
  stuck: boolean;
}) {
  return (
    <ActionButton
      action={resendHandoffAction}
      workspace={slug}
      fields={{ runId, stopId }}
      notice={`Resent the handoff to ${agentName}`}
      analytics={{ event: "handoff_resend", params: { stuck } }}
      aria-label={`Resend handoff of ${stopName} to ${agentName}`}
      size="sm"
      variant="ghost"
    >
      <Send aria-hidden />
      Resend handoff
    </ActionButton>
  );
}
