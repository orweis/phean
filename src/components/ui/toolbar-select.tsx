import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

interface ToolbarSelectProps extends Omit<ComponentProps<"select">, "className"> {
  /** The short visible label inside the capsule ("Goal"). */
  label: string;
  /** What the control does, for screen readers ("Filter by goal"). */
  "aria-label": string;
  className?: string;
}

/**
 * A filter in a page's toolbar: a capsule at the height of the segmented controls beside it,
 * "Goal: All goals ▾". Fields inside forms stay the rectangular `Select`.
 */
export function ToolbarSelect({ label, className, children, ...select }: ToolbarSelectProps) {
  return (
    <label
      className={cx(
        "relative inline-flex h-8.5 max-w-full min-w-0 items-center gap-1 rounded-full bg-fill pr-2 pl-3.5 text-xs transition-colors duration-(--dur-micro) hover:bg-rule",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
        className,
      )}
    >
      <span className="shrink-0 text-ink-2">{label}:</span>
      <select
        {...select}
        className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent pr-5 font-semibold text-ink outline-none"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-ink-2" aria-hidden />
    </label>
  );
}
