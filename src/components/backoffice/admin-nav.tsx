"use client";

import { Activity, Bot, Building2, Gauge, HeartPulse, LayoutDashboard, ScrollText, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

import { useChipRail } from "@/components/ui/chip-rail";
import { cx } from "@/lib/cx";

/** One tab, as the server layout hands it over (paths stay out of the client bundle's route table). */
export interface AdminTab {
  key: string;
  label: string;
  href: string;
  exact: boolean;
}

const ICONS: Record<string, typeof Bot> = {
  overview: LayoutDashboard,
  activation: Activity,
  workspaces: Building2,
  people: Users,
  agents: Bot,
  usage: Gauge,
  health: HeartPulse,
  audit: ScrollText,
};

/** The backoffice's tabs, a chip rail like the workspace's: it scrolls sideways on a phone. */
export function AdminNav({ tabs }: { tabs: readonly AdminTab[] }) {
  const pathname = usePathname();
  const rail = useRef<HTMLElement>(null);
  useChipRail(rail, pathname);
  return (
    <nav ref={rail} aria-label="Backoffice" className="chip-rail relative -mx-1 flex gap-0.5 after:block after:w-1 after:shrink-0 after:content-['']">
      {tabs.map((page) => {
        const target = page.href;
        const active = page.exact ? pathname === target : pathname.startsWith(target);
        const Icon = ICONS[page.key] ?? LayoutDashboard;
        return (
          <Link
            key={page.key}
            href={target}
            aria-current={active ? "page" : undefined}
            className={cx(
              "relative my-1 flex h-9 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-(--dur-micro)",
              active ? "bg-accent-tint font-semibold text-accent-ink" : "text-ink-2 hover:bg-fill hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {page.label}
          </Link>
        );
      })}
    </nav>
  );
}
