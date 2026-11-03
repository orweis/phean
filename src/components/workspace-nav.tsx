"use client";

import { Bot, Brain, CalendarRange, KanbanSquare, LayoutDashboard, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";

/** Counts shown on the tab rail, so the extent of what waits is visible from every page. */
export interface NavCounts {
  awaitingApproval: number;
  inbox: number;
}

const TABS = [
  { label: "Overview", icon: LayoutDashboard, href: routes.workspace, exact: true, count: "awaitingApproval" },
  { label: "Board", icon: KanbanSquare, href: routes.board, count: "inbox" },
  { label: "Timeline", icon: CalendarRange, href: routes.timeline },
  { label: "Memory", icon: Brain, href: routes.memory },
  { label: "Search", icon: Search, href: routes.search },
  { label: "Agents", icon: Bot, href: routes.agents },
  { label: "Members", icon: Users, href: routes.members },
] as const;

const COUNT_LABELS: Record<keyof NavCounts, string> = {
  awaitingApproval: "awaiting approval",
  inbox: "in the inbox",
};

export function WorkspaceNav({ slug, counts }: { slug: string; counts: NavCounts }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="relative -mx-1 flex gap-0.5 overflow-x-auto max-sm:pr-10 max-sm:mask-r-from-[calc(100%-2.5rem)]">
      {TABS.map(({ label, icon: Icon, href, ...tab }) => {
        const target = href(slug);
        const active = "exact" in tab ? pathname === target : pathname.startsWith(target);
        const count = "count" in tab ? counts[tab.count] : 0;
        return (
          <Link
            key={label}
            href={target}
            aria-current={active ? "page" : undefined}
            className={cx(
              "relative my-1 flex h-9 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-(--dur-micro)",
              active ? "bg-accent-tint font-semibold text-accent-ink" : "text-ink-2 hover:bg-fill hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {count > 0 && "count" in tab && (
              <span className="min-w-4.5 rounded-full bg-signal px-1.5 text-center text-xs leading-4.5 font-bold text-on-signal">
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
