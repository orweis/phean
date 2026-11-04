import { Activity as ActivityIcon } from "lucide-react";
import Link from "next/link";

import { groupActivity, type ActivityGroup } from "@/lib/activity";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { Activity } from "@/server/domain/events";

import { ActorAvatar } from "./ui/avatar";
import { EmptyState } from "./ui/stat";

/** Entries shown before the rest fold away, so the card ends cleanly instead of scrolling inside the page. */
const SHOWN = 8;

/** Older captures were logged as "from manual"; they read as what they were. */
const reworded = (summary: string) => summary.replace(/ from manual$/, " by hand");

function Entry({ group, slug }: { group: ActivityGroup<Activity>; slug: string }) {
  const { latest, summary, events } = group;
  const goalLink = latest.entityType === "goal" && events.length === 1 ? routes.goal(slug, latest.entityId) : null;
  return (
    <li className="flex gap-2.5">
      <ActorAvatar type={latest.actorType} />
      <div className="min-w-0 text-sm">
        <p className="text-ink-2">
          <span className="font-semibold text-ink">{latest.actorName}</span>{" "}
          {goalLink ? (
            <Link href={goalLink} className="hover:text-ink link">
              {reworded(summary)}
            </Link>
          ) : (
            reworded(summary)
          )}
        </p>
        <time dateTime={latest.createdAt.toISOString()} className="text-xs text-muted">
          {timeAgo(latest.createdAt)}
        </time>
      </div>
    </li>
  );
}

/**
 * Humans and agents, newest first, with runs of one actor doing one thing collapsed into a line.
 * The first entries show; the rest fold behind "Show more", like the board's Done lane.
 */
export function ActivityFeed({ events, slug, shown = SHOWN }: { events: readonly Activity[]; slug: string; shown?: number }) {
  const groups = groupActivity(events);
  if (groups.length === 0) {
    return (
      <EmptyState icon={<ActivityIcon />} title="No activity yet">
        Everything humans and agents do in this workspace shows up here.
      </EmptyState>
    );
  }
  const first = groups.slice(0, shown);
  const rest = groups.slice(shown);
  return (
    <div>
      <ol className="space-y-3">
        {first.map((group) => (
          <Entry key={group.key} group={group} slug={slug} />
        ))}
      </ol>
      {rest.length > 0 && (
        <details className="group/more mt-3">
          <summary className="cursor-pointer list-none text-xs font-semibold text-ink-2 link hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">Show {rest.length} more</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <ol className="mt-3 space-y-3">
            {rest.map((group) => (
              <Entry key={group.key} group={group} slug={slug} />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
