import { Activity as ActivityIcon, Bot, User } from "lucide-react";
import Link from "next/link";

import { groupActivity } from "@/lib/activity";
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
              className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${isAgent ? "bg-sky-50 text-sky-600" : "bg-violet-50 text-violet-600"}`}
            >
              <Icon className="size-3.5" aria-label={isAgent ? "Agent" : "Person"} />
            </span>
            <div className="min-w-0 text-sm">
              <p className="text-zinc-700">
                <span className="font-medium text-zinc-900">{latest.actorName}</span>{" "}
                {goalLink ? (
                  <Link href={goalLink} className="hover:underline">
                    {summary}
                  </Link>
                ) : (
                  summary
                )}
              </p>
              <time dateTime={latest.createdAt.toISOString()} className="text-xs text-zinc-400">
                {timeAgo(latest.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
