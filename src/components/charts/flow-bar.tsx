import Link from "next/link";

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
  /**
   * Where each station's tasks are listed. With it, every segment is a shortcut for the pointer; the
   * bar is then decorative, and the legend beside it carries the same links for keyboards and
   * screen readers, so it must be shown with the same `hrefFor`.
   */
  hrefFor?: (station: Station) => string;
}

/** Tasks by station as one stacked bar, in the order work flows. */
export function FlowBar({ counts, label, size = "sm", stations = STATIONS, className, hrefFor }: FlowBarProps) {
  const shown = stations.filter((station) => (counts[station] ?? 0) > 0);
  const segment = cx("min-w-1 rounded-xs", hrefFor && "transition-opacity duration-(--dur-micro) hover:opacity-80");
  return (
    <div
      role={hrefFor ? undefined : "img"}
      aria-label={hrefFor ? undefined : `${label}: ${describeCounts(counts, stations)}`}
      aria-hidden={hrefFor ? true : undefined}
      className={cx("flex gap-0.5", SIZES[size], className)}
    >
      {shown.length === 0 ? (
        // Nothing open: a dashed hairline, so an empty bar draws less attention than a full one.
        <span data-empty className="flex-1 self-center border-t border-dashed border-edge" />
      ) : (
        shown.map((station) =>
          hrefFor ? (
            <Link key={station} href={hrefFor(station)} tabIndex={-1} className={cx(segment, STATION_STYLE[station].fill)} style={{ flexGrow: counts[station] }} />
          ) : (
            <span key={station} className={cx(segment, STATION_STYLE[station].fill)} style={{ flexGrow: counts[station] }} />
          ),
        )
      )}
    </div>
  );
}

interface FlowLegendProps {
  counts?: StationCounts;
  stations?: readonly Station[];
  className?: string;
  /** Turns each entry into a link to that station's tasks. */
  hrefFor?: (station: Station) => string;
  /** Names the legend when it is the bar's only text, as it is when the bar links. */
  label?: string;
}

/** Swatches with counts, the key for a `FlowBar` or the flow chart; with `hrefFor`, each entry opens its tasks. */
export function FlowLegend({ counts, stations = STATIONS, className, hrefFor, label }: FlowLegendProps) {
  return (
    <ul aria-label={label} className={cx("flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2", className)}>
      {stations.map((station) => {
        const content = (
          <>
            <span aria-hidden className={cx("size-2.5 rounded-xs", STATION_STYLE[station].fill)} />
            {STATION_STYLE[station].label}
            {counts && <span className="font-semibold text-ink">{` ${counts[station] ?? 0}`}</span>}
          </>
        );
        return (
          <li key={station} className="inline-flex items-center gap-1.5">
            {/* A station with nothing in it has nothing to open. */}
            {hrefFor && (!counts || counts[station]) ? (
              <Link href={hrefFor(station)} className="link inline-flex items-center gap-1.5 hover:text-ink">
                {content}
                <span className="sr-only">: open them as a table</span>
              </Link>
            ) : (
              content
            )}
          </li>
        );
      })}
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
  /** Where each station's tasks are listed; makes the bar's segments and the legend's entries links. */
  hrefFor?: (station: Station) => string;
}

/** The wide first cell of a `StatStrip`: work by station as a bar with its key. */
export function FlowStat({ label, figure, counts, stations, caption = label, hrefFor }: FlowStatProps) {
  return (
    <div className="col-span-2 min-w-0 bg-panel px-4 py-3 sm:col-span-4 lg:col-span-1">
      <p className="flex items-baseline justify-between gap-3 text-xs text-muted">
        {caption}
        <span className="text-sm font-bold text-ink">{figure}</span>
      </p>
      <FlowBar counts={counts} stations={stations} size="lg" label={label} className="mt-2" hrefFor={hrefFor} />
      <FlowLegend counts={counts} stations={stations} className="mt-2" hrefFor={hrefFor} label={hrefFor ? label : undefined} />
    </div>
  );
}
