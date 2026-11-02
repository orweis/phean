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
    <nav aria-label="Workspace" className="-mx-2 flex overflow-x-auto">
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
              "relative flex h-11 items-center gap-1.5 px-2.5 text-sm whitespace-nowrap transition-colors duration-(--dur-micro)",
              "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t-xs",
              active ? "font-semibold text-shell-ink after:bg-signal" : "text-shell-muted after:bg-transparent hover:text-shell-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
            {count > 0 && "count" in tab && (
              <span className="rounded-sm bg-signal px-1.5 text-xs leading-4.5 font-bold text-signal-ink">
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
