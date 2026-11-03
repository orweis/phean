import { cx } from "@/lib/cx";
import { STATIONS, type Station } from "@/lib/domain";

import { describeCounts, STATION_STYLE, type StationCounts } from "./stations";

const SIZES = { sm: "h-1.5", md: "h-2.5", lg: "h-4" } as const;

interface FlowBarProps {
  counts: StationCounts;
  /** Names the bar for screen readers, e.g. "Open work by status". */
  label: string;
  size?: keyof typeof SIZES;
  stations?: readonly Station[];
  className?: string;
}

/** Tasks by station as one stacked bar, in the order work flows. */
export function FlowBar({ counts, label, size = "sm", stations = STATIONS, className }: FlowBarProps) {
  const shown = stations.filter((station) => (counts[station] ?? 0) > 0);
  return (
    <div role="img" aria-label={`${label}: ${describeCounts(counts, stations)}`} className={cx("flex gap-0.5", SIZES[size], className)}>
      {shown.length === 0 ? (
        <span className="flex-1 rounded-xs bg-fill" />
      ) : (
        shown.map((station) => (
          <span key={station} className={cx("min-w-1 rounded-xs", STATION_STYLE[station].fill)} style={{ flexGrow: counts[station] }} />
        ))
      )}
    </div>
  );
}

/** Swatches with counts, the key for a `FlowBar` or the flow chart. */
export function FlowLegend({ counts, stations = STATIONS, className }: { counts?: StationCounts; stations?: readonly Station[]; className?: string }) {
  return (
    <ul className={cx("flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2", className)}>
      {stations.map((station) => (
        <li key={station} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cx("size-2.5 rounded-xs", STATION_STYLE[station].fill)} />
          {STATION_STYLE[station].label}
          {counts && <span className="font-semibold text-ink">{counts[station] ?? 0}</span>}
        </li>
      ))}
    </ul>
  );
}

interface FlowStatProps {
  /** What the bar counts; also names it for screen readers. */
  label: string;
  /** The headline figure beside the label, e.g. "12 tasks" or "40% done". */
  figure: string;
  counts: StationCounts;
  stations?: readonly Station[];
  /** A heading for the cell when it differs from the bar's name. */
  caption?: string;
}

/** The wide first cell of a `StatStrip`: work by station as a bar with its key. */
export function FlowStat({ label, figure, counts, stations, caption = label }: FlowStatProps) {
  return (
    <div className="col-span-2 min-w-0 bg-panel px-4 py-3 sm:col-span-4 lg:col-span-1">
      <p className="flex items-baseline justify-between gap-3 text-xs text-muted">
        {caption}
        <span className="text-sm font-bold text-ink">{figure}</span>
      </p>
      <FlowBar counts={counts} stations={stations} size="lg" label={label} className="mt-2" />
      <FlowLegend counts={counts} stations={stations} className="mt-2" />
    </div>
  );
}
