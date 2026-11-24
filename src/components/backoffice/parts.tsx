import { ArrowDown, ArrowUp, ArrowUpDown, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";

/** Zero recedes to a dash (read as "0"), so the figures that matter stand out in a dense table. */
export function Figure({ value, className }: { value: number; className?: string }) {
  if (value !== 0) return <span className={className}>{value.toLocaleString("en")}</span>;
  return (
    <span className="text-muted">
      <span aria-hidden>–</span>
      <span className="sr-only">0</span>
    </span>
  );
}

/** Shown in place of a page when the backoffice demands two-factor and the admin has none. */
export function TwoFactorGate() {
  return (
    <Card>
      <EmptyState icon={<ShieldAlert />} title="Turn on two-factor to use the backoffice">
        <p>The backoffice shows every customer&apos;s data, so it asks for a second step at sign-in.</p>
        <ButtonLink href={routes.account()} variant="primary" size="sm" className="mt-3">
          Set up two-factor
        </ButtonLink>
      </EmptyState>
    </Card>
  );
}

interface SortHeaderProps {
  label: string;
  /** Where the heading leads: the same table sorted by this column (or reversed). */
  href: string;
  active: boolean;
  direction: "asc" | "desc";
  /** The direction a click asks for. */
  next: "asc" | "desc";
  first?: boolean;
  align?: "left" | "right";
}

/** A column heading that sorts, as the Tasks table's do: a link, `aria-sort` on the leading one. */
export function SortHeader({ label, href, active, direction, next, first = false, align = "right" }: SortHeaderProps) {
  const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}
      className={cx(TH, align === "left" ? "text-left" : "text-right", first && cx("pl-5", PINNED_CELL))}
    >
      <Link href={href} scroll={false} className={cx("group/sort inline-flex items-center gap-1 rounded-xs hover:text-ink", active && "text-ink")}>
        {label}
        <span className="sr-only">{`, sort ${next === "asc" ? "ascending" : "descending"}`}</span>
        {active ? (
          <Arrow aria-hidden className="size-3" />
        ) : (
          <ArrowUpDown aria-hidden className="size-3 opacity-0 transition-opacity group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100" />
        )}
      </Link>
    </th>
  );
}

/** "Page 2 of 4 · 87 workspaces" with Previous and Next, as links, under a table. */
export function Pager({ page, pageSize, total, noun, href }: { page: number; pageSize: number; total: number; noun: string; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label={`Pages of ${noun}`} className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-5 py-3 text-xs text-muted">
      <p>
        Page <span className="figure font-semibold text-ink">{page}</span> of {pages} · {total.toLocaleString("en")} {noun}
      </p>
      <div className="flex gap-2">
        {page > 1 && (
          <ButtonLink href={href(page - 1)} size="sm" variant="secondary" rel="prev">
            Previous
          </ButtonLink>
        )}
        {page < pages && (
          <ButtonLink href={href(page + 1)} size="sm" variant="secondary" rel="next">
            Next
          </ButtonLink>
        )}
      </div>
    </nav>
  );
}

/** A label and its value in a definition list, for a card's facts. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="figure mt-0.5 truncate text-lg font-bold text-ink">{children}</dd>
    </div>
  );
}

/**
 * A wide table's sideways scroller, inside its card. It takes focus, so a keyboard can scroll a table
 * that holds no links (axe's scrollable-region-focusable), and it is named for screen readers.
 */
export function TableScroll({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cx("relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus", className)}>
      {children}
    </div>
  );
}
