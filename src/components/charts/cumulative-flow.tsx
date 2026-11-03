import { ChartArea } from "lucide-react";

import { cx } from "@/lib/cx";
import { formatDay } from "@/lib/format";
import type { FlowCounts, Station } from "@/lib/timeline";

import { EmptyState } from "../ui/stat";
import { FlowLegend } from "./flow-bar";
import { describeCounts, STATION_STYLE } from "./stations";

/** Bottom to top: finished work is the floor the open stations ride on. */
const LAYERS: readonly Station[] = ["done", "in_progress", "todo", "inbox"];
const LEGEND_ORDER: readonly Station[] = [...LAYERS].reverse();
/** Days with tasks on the line before the flow is drawn; fewer show no trend. */
const MIN_HISTORY_DAYS = 3;

interface FlowPoint {
  day: Date;
  counts: FlowCounts;
}

function niceCeiling(value: number): number {
  const step = value <= 8 ? 2 : value <= 40 ? 10 : value <= 200 ? 50 : 100;
  return Math.max(step, Math.ceil(value / step) * step);
}

const below = (counts: FlowCounts, layer: number) => LAYERS.slice(0, layer).reduce((sum, station) => sum + counts[station], 0);

/**
 * Stacked area of how many tasks stood at each station at the end of every day. A widening
 * band means work is piling up there; a rising green floor means work is arriving.
 */
export function CumulativeFlow({ flow, className }: { flow: readonly FlowPoint[]; className?: string }) {
  const started = flow.findIndex((point) => below(point.counts, LAYERS.length) > 0);
  if (started === -1 || flow.length - started < MIN_HISTORY_DAYS) {
    return (
      <EmptyState icon={<ChartArea />} title="The flow fills in after a few days">
        It draws how many tasks stood at each status at the end of every day, so it needs {MIN_HISTORY_DAYS} days of work to show a trend.
      </EmptyState>
    );
  }
  const points = flow.length === 1 ? [flow[0]!, flow[0]!] : flow;
  const max = niceCeiling(Math.max(1, ...points.map((point) => below(point.counts, LAYERS.length))));
  const x = (index: number) => (index / (points.length - 1)) * 100;
  const y = (value: number) => 100 - (value / max) * 100;

  const area = (layer: number) => {
    const top = points.map((point, index) => `${x(index)},${y(below(point.counts, layer + 1))}`);
    const bottom = points.map((point, index) => `${x(index)},${y(below(point.counts, layer))}`).reverse();
    return `M${top.join("L")}L${bottom.join("L")}Z`;
  };

  const first = flow[0]!;
  const last = flow.at(-1)!;
  const columnWidth = 100 / Math.max(1, flow.length - 1);

  return (
    <figure className={cx("min-w-0", className)}>
      <div className="relative ml-7 h-44 sm:h-52">
        {[0, 0.5, 1].map((share) => (
          <div key={share} className="absolute inset-x-0 border-t border-rule" style={{ top: `${(1 - share) * 100}%` }}>
            <span className="absolute -top-2 -left-7 w-5 text-right text-2xs text-muted">{max * share}</span>
          </div>
        ))}

        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden className="absolute inset-0 size-full overflow-visible">
          {LAYERS.map((station, layer) => (
            <path key={station} d={area(layer)} className={cx(STATION_STYLE[station].svg, "stroke-panel")} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>

        <div aria-hidden data-now className="absolute inset-y-0 -right-px w-0.5 bg-late">
          <span className="absolute -top-5 right-0 text-2xs font-bold text-late-ink">Now</span>
        </div>

        {flow.map((point, index) => {
          const left = Math.max(0, (index - 0.5) * columnWidth);
          const right = Math.min(100, (index + 0.5) * columnWidth);
          return (
            <div key={point.day.toISOString()} className="group/day absolute inset-y-0" style={{ left: `${left}%`, width: `${right - left}%` }}>
              <span
                className="absolute inset-y-0 w-px bg-ink/50 opacity-0 group-hover/day:opacity-100"
                style={{ left: `${((index * columnWidth - left) / (right - left)) * 100}%` }}
              />
              <span
                className={cx(
                  "pointer-events-none absolute top-2 z-10 hidden w-max rounded-md border border-rule bg-panel px-2.5 py-1.5 text-xs shadow-pop group-hover/day:block",
                  index < flow.length / 2 ? "left-1/2" : "right-1/2",
                )}
              >
                <span className="block font-bold text-ink">{formatDay(point.day)}</span>
                {LEGEND_ORDER.map((station) => (
                  <span key={station} className="flex items-center gap-1.5 text-ink-2">
                    <span className={cx("size-2 rounded-xs", STATION_STYLE[station].fill)} />
                    {STATION_STYLE[station].label}
                    <span className="ml-auto pl-3 font-semibold text-ink">{point.counts[station]}</span>
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>

      <div aria-hidden className="ml-7 mt-1.5 flex justify-between text-2xs text-muted">
        <span>{formatDay(first.day)}</span>
        {flow.length > 2 && <span>{formatDay(flow[Math.floor((flow.length - 1) / 2)]!.day)}</span>}
        <span>Today</span>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <FlowLegend stations={LEGEND_ORDER} />
        <details className="text-xs open:basis-full">
          <summary className="cursor-pointer list-none font-semibold text-ink-2 link hover:text-ink [&::-webkit-details-marker]:hidden">
            Show the numbers
          </summary>
          <div className="relative mt-2 overflow-x-auto">
            <table className="w-full">
              <caption className="sr-only">Tasks at each status at the end of each day</caption>
              <thead>
                <tr className="border-b border-rule text-muted">
                  <th scope="col" className="py-1.5 pr-3 text-left font-semibold">
                    Day
                  </th>
                  {LEGEND_ORDER.map((station) => (
                    <th key={station} scope="col" className="px-3 py-1.5 text-right font-semibold whitespace-nowrap">
                      {STATION_STYLE[station].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {flow.map((point) => (
                  <tr key={point.day.toISOString()}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-semibold whitespace-nowrap text-ink">
                      {formatDay(point.day)}
                    </th>
                    {LEGEND_ORDER.map((station) => (
                      <td key={station} className={cx("px-3 py-1.5 text-right", point.counts[station] ? "text-ink" : "text-muted")}>
                        {point.counts[station]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <figcaption className="sr-only">
        From {formatDay(first.day)} to today. Now: {describeCounts(last.counts, LEGEND_ORDER)}.
      </figcaption>
    </figure>
  );
}
