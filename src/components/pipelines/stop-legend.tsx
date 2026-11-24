import { STOP_VIEW_META, STOP_VIEW_STATES } from "@/lib/domain";
import { cx } from "@/lib/cx";

import { StopDot } from "./stop-mark";

/** The key to the stop marks: each state's icon and line form, with its word. */
export function StopLegend({ className }: { className?: string }) {
  return (
    <ul aria-label="Key" className={cx("flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2", className)}>
      {STOP_VIEW_STATES.map((state) => (
        <li key={state} className="inline-flex items-center gap-1.5">
          <StopDot state={state} size="sm" />
          {STOP_VIEW_META[state].label}
        </li>
      ))}
    </ul>
  );
}
