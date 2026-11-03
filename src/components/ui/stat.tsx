import Link from "next/link";
import type { ReactNode } from "react";

import type { Tone } from "@/lib/domain";
import { cx } from "@/lib/cx";

const VALUE_TONES: Partial<Record<Tone, string>> = {
  danger: "text-late-ink",
  warning: "text-wait-ink",
  success: "text-arrive-ink",
  info: "text-move-ink",
};

/** A row of figures separated by hairlines; each cell is a `Stat`. */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("grid gap-px overflow-hidden rounded-lg border border-rule bg-rule", className)}>{children}</div>;
}

interface StatProps {
  label: string;
  value: number | string;
  hint?: ReactNode;
  /** Highlights the value, e.g. danger when something is late. */
  tone?: Tone;
  href?: string;
}

export function Stat({ label, value, hint, tone, href }: StatProps) {
  const body = (
    <>
      <span className="block text-xs text-muted">{label}</span>
      <span className={cx("figure mt-0.5 block text-xl font-bold", (tone && VALUE_TONES[tone]) || "text-ink")}>
        {value}
      </span>
      {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
    </>
  );
  const className = "block min-w-0 bg-panel px-4 py-3";
  return href ? (
    <Link href={href} className={cx(className, "transition-colors duration-(--dur-micro) hover:bg-fill")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function ProgressBar({ value, className, label }: { value: number; className?: string; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx("h-1.5 overflow-hidden rounded-full bg-fill", className)}
    >
      <div className={cx("h-full rounded-full", pct === 100 ? "bg-arrive" : "bg-accent")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      {icon && <div className="mb-2 text-faint [&_svg]:size-6">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-xs text-muted">{children}</div>}
    </div>
  );
}
