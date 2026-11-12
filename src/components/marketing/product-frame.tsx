import type { ReactNode } from "react";

import { LogoMark } from "@/components/logo";
import { cx } from "@/lib/cx";

const TABS = ["Overview", "Decisions", "Tasks", "Goals", "Timeline"] as const;

/**
 * A picture of the app for the marketing site: its glass header and tab rail in miniature, around
 * whatever screen the section shows. Decorative chrome; the content inside carries the meaning.
 */
export function ProductFrame({ active, counts = {}, children, className, label }: { active: (typeof TABS)[number]; counts?: Partial<Record<(typeof TABS)[number], number>>; children: ReactNode; className?: string; label: string }) {
  return (
    <figure className={cx("product-frame", className)}>
      <div aria-hidden className="border-b border-rule bg-glass px-4 pt-3">
        <div className="flex items-center gap-2 text-xs">
          <LogoMark className="size-4" />
          <span className="font-semibold text-ink">Phean</span>
          <span className="text-faint">/</span>
          <span className="font-semibold text-ink-2">Globex</span>
          <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-accent-tint text-2xs font-bold text-accent-ink">D</span>
        </div>
        <div className="mt-2.5 flex gap-1 overflow-hidden pb-2">
          {TABS.map((tab) => (
            <span
              key={tab}
              className={cx("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-2xs", tab === active ? "bg-accent-tint font-semibold text-accent-ink" : "text-ink-2")}
            >
              {tab}
              {counts[tab] ? <span className="rounded-full bg-signal px-1.5 text-2xs leading-4 font-bold text-on-signal">{counts[tab]}</span> : null}
            </span>
          ))}
        </div>
      </div>
      <div className="bg-paper">{children}</div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
