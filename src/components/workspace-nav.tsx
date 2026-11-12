"use client";

import { Bot, Brain, CalendarRange, FileText, KanbanSquare, LayoutDashboard, Scale, Search, Target, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { useChipRail } from "@/components/ui/chip-rail";
import { cx } from "@/lib/cx";
import { WORKSPACE_PAGES, type WorkspacePageKey } from "@/lib/workspace-pages";

/** Counts shown on the tab rail, so the extent of what waits is visible from every page. */
export interface NavCounts {
  /** Goals to approve and agent questions to answer. */
  waitingOnYou: number;
  /** Agent questions and decisions, and goals to approve: what the Decisions page lists as waiting. */
  decisions: number;
  inbox: number;
}

/** The rail's icon and count for each workspace page; the pages themselves are `WORKSPACE_PAGES`. */
const TAB_EXTRAS: Record<WorkspacePageKey, { icon: typeof Bot; count?: keyof NavCounts; quiet?: boolean }> = {
  overview: { icon: LayoutDashboard, count: "waitingOnYou" },
  decisions: { icon: Scale, count: "decisions" },
  tasks: { icon: KanbanSquare, count: "inbox", quiet: true },
  goals: { icon: Target },
  timeline: { icon: CalendarRange },
  memory: { icon: Brain },
  documents: { icon: FileText },
  search: { icon: Search },
  agents: { icon: Bot },
  members: { icon: Users },
};

const TABS = WORKSPACE_PAGES.map((page) => ({ ...page, ...TAB_EXTRAS[page.key] }));

const COUNT_LABELS: Record<keyof NavCounts, string> = {
  waitingOnYou: "waiting on you",
  decisions: "waiting on you",
  inbox: "in the inbox",
};

/**
 * The workspace's tabs. A clicked tab turns active at once, before its page arrives, so two tabs
 * never look active together; on phones the rail scrolls the active tab into view. Ember counts
 * are what needs a person (Overview, Decisions); the inbox count is neutral.
 */
export function WorkspaceNav({ slug, counts }: { slug: string; counts: NavCounts }) {
  const pathname = usePathname();
  const [clicked, setClicked] = useState<{ from: string; to: string } | null>(null);
  const rail = useRef<HTMLElement>(null);
  const heading = clicked && clicked.from === pathname ? clicked.to : null;

  useChipRail(rail, heading ?? pathname);

  return (
    <nav ref={rail} aria-label="Workspace" className="chip-rail relative -mx-1 flex gap-0.5">
      {TABS.map(({ label, icon: Icon, href, ...tab }) => {
        const target = href(slug);
        const here = "exact" in tab ? pathname === target : pathname.startsWith(target);
        const active = heading ? heading === target : here;
        const count = tab.count ? counts[tab.count] : 0;
        return (
          <Link
            key={label}
            href={target}
            onClick={(event) => {
              if (!here && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) setClicked({ from: pathname, to: target });
            }}
            aria-current={active ? "page" : undefined}
            className={cx(
              "relative my-1 flex h-9 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-(--dur-micro)",
              active ? "bg-accent-tint font-semibold text-accent-ink" : "text-ink-2 hover:bg-fill hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {count > 0 && tab.count && (
              <span
                className={cx(
                  "min-w-4.5 rounded-full px-1.5 text-center text-xs leading-4.5 font-bold",
                  tab.quiet ? "bg-fill text-ink-2" : "bg-signal text-on-signal",
                  tab.quiet && active && "bg-panel",
                )}
              >
                {count}
                <span className="sr-only"> {COUNT_LABELS[tab.count]}</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
