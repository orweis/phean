import type { ReactNode } from "react";

import type { Tone } from "@/lib/domain";
import { cx } from "@/lib/cx";

const TONES: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  accent: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap ring-1 ring-inset [&_svg]:size-3",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Renders any domain enum value through its `{ label, tone }` metadata table. */
export function MetaBadge<K extends string>({ meta, value }: { meta: Record<K, { label: string; tone: Tone }>; value: K }) {
  const { label, tone } = meta[value];
  return <Badge tone={tone}>{label}</Badge>;
}
