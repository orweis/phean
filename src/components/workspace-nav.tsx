"use client";

import { Bot, Brain, CalendarRange, KanbanSquare, LayoutDashboard, Scale, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";

/** Counts shown on the tab rail, so the extent of what waits is visible from every page. */
export interface NavCounts {
  /** Goals to approve and agent questions to answer. */
  waitingOnYou: number;
  /** Agent questions and decisions, and goals to approve: what the Decisions page lists as waiting. */
  decisions: number;
  inbox: number;
}

const TABS = [
  { label: "Overview", icon: LayoutDashboard, href: routes.workspace, exact: true, count: "waitingOnYou" },
  { label: "Decisions", icon: Scale, href: routes.decisions, count: "decisions" },
  { label: "Board", icon: KanbanSquare, href: routes.board, count: "inbox", quiet: true },
  { label: "Timeline", icon: CalendarRange, href: routes.timeline },
  { label: "Memory", icon: Brain, href: routes.memory },
  { label: "Search", icon: Search, href: routes.search },
  { label: "Agents", icon: Bot, href: routes.agents },
  { label: "Members", icon: Users, href: routes.members },
] as const;

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

  useEffect(() => {
    const current = rail.current?.querySelector<HTMLElement>("[aria-current=page]");
    if (!current || !rail.current || rail.current.scrollWidth <= rail.current.clientWidth) return;
    current.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <nav ref={rail} aria-label="Workspace" className="relative -mx-1 flex gap-0.5 overflow-x-auto max-sm:pr-10 max-sm:mask-r-from-[calc(100%-2.5rem)]">
      {TABS.map(({ label, icon: Icon, href, ...tab }) => {
        const target = href(slug);
        const here = "exact" in tab ? pathname === target : pathname.startsWith(target);
        const active = heading ? heading === target : here;
        const count = "count" in tab ? counts[tab.count] : 0;
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
            {count > 0 && "count" in tab && (
              <span
                className={cx(
                  "min-w-4.5 rounded-full px-1.5 text-center text-xs leading-4.5 font-bold",
                  "quiet" in tab ? "bg-fill text-ink-2" : "bg-signal text-on-signal",
                  "quiet" in tab && active && "bg-panel",
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
