import { Sparkles } from "lucide-react";

import { cx } from "@/lib/cx";

/**
 * Marks the option an agent recommends ("Recommended") or a pick it suggests ("Suggested"), in words
 * as well as a mark, so the recommendation never rests on colour. It sits inside the option's button
 * or label, so it is read as part of the option's name.
 */
export function RecommendedTag({ label = "Recommended", className }: { label?: "Recommended" | "Suggested"; className?: string }) {
  return (
    <span data-recommended className={cx("inline-flex shrink-0 items-center gap-1 rounded-full bg-panel/70 px-1.5 py-px text-2xs font-semibold [&_svg]:size-3", className)}>
      <Sparkles aria-hidden />
      <span className="sr-only">(</span>
      {label}
      <span className="sr-only">)</span>
    </span>
  );
}
