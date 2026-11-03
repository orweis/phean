import { Activity as ActivityIcon, Bot, User } from "lucide-react";
import Link from "next/link";

import { groupActivity } from "@/lib/activity";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { Activity } from "@/server/domain/events";

import { EmptyState } from "./ui/stat";

export function ActivityFeed({ events, slug }: { events: readonly Activity[]; slug: string }) {
  const groups = groupActivity(events);
  if (groups.length === 0) {
    return (
      <EmptyState icon={<ActivityIcon />} title="No activity yet">
        Everything humans and agents do in this workspace shows up here.
      </EmptyState>
    );
  }
  return (
    <ol className="space-y-3">
      {groups.map(({ key, latest, summary, events: grouped }) => {
        const isAgent = latest.actorType === "agent";
        const Icon = isAgent ? Bot : User;
        const goalLink = latest.entityType === "goal" && grouped.length === 1 ? routes.goal(slug, latest.entityId) : null;
        return (
          <li key={key} className="flex gap-2.5">
            <span
              className={cx(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
                isAgent ? "bg-move-tint text-move-ink" : "bg-sunken text-ink-2",
              )}
            >
              <Icon className="size-3.5" aria-label={isAgent ? "Agent" : "Person"} />
            </span>
            <div className="min-w-0 text-sm">
              <p className="text-ink-2">
                <span className="font-semibold text-ink">{latest.actorName}</span>{" "}
                {goalLink ? (
                  <Link href={goalLink} className="hover:text-ink link">
                    {summary}
                  </Link>
                ) : (
                  summary
                )}
              </p>
              <time dateTime={latest.createdAt.toISOString()} className="text-xs text-muted">
                {timeAgo(latest.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
