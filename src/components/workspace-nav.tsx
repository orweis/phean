"use client";

import { Bot, Brain, KanbanSquare, LayoutDashboard, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";

const TABS = [
  { label: "Overview", icon: LayoutDashboard, href: routes.workspace, exact: true },
  { label: "Board", icon: KanbanSquare, href: routes.board },
  { label: "Memory", icon: Brain, href: routes.memory },
  { label: "Search", icon: Search, href: routes.search },
  { label: "Agents", icon: Bot, href: routes.agents },
  { label: "Members", icon: Users, href: routes.members },
] as const;

export function WorkspaceNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="-mb-px flex gap-1 overflow-x-auto">
      {TABS.map(({ label, icon: Icon, href, ...tab }) => {
        const target = href(slug);
        const active = "exact" in tab ? pathname === target : pathname.startsWith(target);
        return (
          <Link
            key={label}
            href={target}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-1.5 border-b-2 px-2.5 pt-1 pb-2.5 text-sm whitespace-nowrap transition-colors",
              active ? "border-zinc-900 font-medium text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-900",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
