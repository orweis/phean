import { Sparkles } from "lucide-react";

import { cx } from "@/lib/cx";

const TONES = {
  /** On a tinted option (the Decisions page): a lighter capsule in the option's own ink. */
  tinted: "bg-panel/70",
  /** On a filled brand button: an outline in the button's own text colour. */
  filled: "ring-1 ring-current/60 ring-inset",
  /** Beside a tick row: a quiet grey capsule. */
  quiet: "bg-fill text-ink-2",
} as const;

/**
 * Marks the option an agent recommends ("Recommended") or a pick it suggests ("Suggested"), in words
 * as well as a mark, so the recommendation never rests on colour. It sits inside the option's button
 * or label, so it is read as part of the option's name.
 */
export function RecommendedTag({ label = "Recommended", tone = "tinted", compact = false }: { label?: "Recommended" | "Suggested"; tone?: keyof typeof TONES; compact?: boolean }) {
  return (
    <span data-recommended className={cx("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-2xs font-semibold [&_svg]:size-3", TONES[tone])}>
      <Sparkles aria-hidden />
      <span className="sr-only">(</span>
      {/* Compact keeps the mark and says the word to screen readers only, where a rail has no room. */}
      <span className={compact ? "sr-only" : undefined}>{label}</span>
      <span className="sr-only">)</span>
    </span>
  );
}
