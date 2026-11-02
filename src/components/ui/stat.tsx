import Link from "next/link";
import type { ReactNode } from "react";

import type { Tone } from "@/lib/domain";
import { cx } from "@/lib/cx";

const VALUE_TONES: Partial<Record<Tone, string>> = {
  danger: "text-red-600",
  warning: "text-amber-600",
  success: "text-emerald-600",
  accent: "text-violet-600",
};

interface StatProps {
  label: string;
  value: number | string;
  hint?: ReactNode;
  /** Highlights the value, e.g. danger when something is overdue. */
  tone?: Tone;
  href?: string;
}

export function Stat({ label, value, hint, tone, href }: StatProps) {
  const body = (
    <>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className={cx("mt-1 text-2xl font-semibold tabular-nums", (tone && VALUE_TONES[tone]) || "text-zinc-900")}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-zinc-500">{hint}</p>}
    </>
  );
  const className = "block rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-xs";
  return href ? (
    <Link href={href} className={cx(className, "transition-colors hover:border-zinc-300")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx("h-1.5 overflow-hidden rounded-full bg-zinc-100", className)}
    >
      <div className={cx("h-full rounded-full", pct === 100 ? "bg-emerald-500" : "bg-violet-500")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      {icon && <div className="mb-2 text-zinc-300 [&_svg]:size-6">{icon}</div>}
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      {children && <div className="mt-1 max-w-sm text-xs text-zinc-500">{children}</div>}
    </div>
  );
}
