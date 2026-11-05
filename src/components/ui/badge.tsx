import type { ReactNode } from "react";

import type { Tone } from "@/lib/domain";
import { cx } from "@/lib/cx";

const TONES: Record<Tone, string> = {
  neutral: "bg-fill text-ink-2",
  info: "bg-move-tint text-move-ink",
  success: "bg-arrive-tint text-arrive-ink",
  warning: "bg-wait-tint text-wait-ink",
  danger: "bg-late-tint text-late-ink",
  accent: "bg-signal-tint text-signal-ink",
  fresh: "bg-inbox-tint text-inbox-ink",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap [&_svg]:size-3",
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
