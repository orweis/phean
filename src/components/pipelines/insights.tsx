import Link from "next/link";

import { cx } from "@/lib/cx";
import { RUN_STATUS_META } from "@/lib/domain";
import { formatDuration, percent, pluralize } from "@/lib/format";
import type { Insights } from "@/lib/pipeline-stats";
import { routes } from "@/lib/routes";

import { Stat, StatStrip } from "../ui/stat";
import { TH } from "../ui/table";

const time = (ms: number | null) => (ms === null ? "None yet" : formatDuration(ms));

/** The headline figures: how often a run reaches an end, and how long a trip takes. */
export function InsightStats({ insights }: { insights: Insights }) {
  return (
    <StatStrip className="grid-cols-2 sm:grid-cols-4">
      <Stat
        label="Success rate"
        value={insights.successRate === null ? "None yet" : percent(insights.successRate)}
        hint={`${insights.succeeded} of ${pluralize(insights.finished, "finished run")}`}
        tone={insights.successRate !== null && insights.successRate < 0.8 ? "warning" : undefined}
      />
      <Stat label="Typical trip (P50)" value={time(insights.tripP50)} hint="runs that reached an end" />
      <Stat label="Slow trip (P90)" value={time(insights.tripP90)} hint="nine in ten are faster" />
      <Stat label="Flaky stops" value={insights.flaky.length} hint="failed, then passed on a retry" tone={insights.flaky.length ? "warning" : undefined} />
    </StatStrip>
  );
}

/** Each stop's typical and slow time, as figures and a bar against the slowest stop. */
export function StopTimesTable({ insights }: { insights: Insights }) {
  const slowest = Math.max(1, ...insights.stops.map((stop) => stop.p90 ?? 0));
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Time per stop, finished runs</caption>
      <thead>
        <tr className="border-b border-rule">
          <th scope="col" className={cx(TH, "pl-0 text-left")}>
            Stop
          </th>
          <th scope="col" className={cx(TH, "text-right")}>
            Runs
          </th>
          <th scope="col" className={cx(TH, "text-right")}>
            P50
          </th>
          <th scope="col" className={cx(TH, "text-right")}>
            P90
          </th>
          <th scope="col" className={cx(TH, "w-1/3 max-sm:hidden")}>
            <span className="sr-only">Bar</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {insights.stops.map((stop) => (
          <tr key={stop.id} data-stop-times={stop.id} className="border-b border-rule last:border-b-0">
            <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">
              {stop.name}
            </th>
            <td className="figure px-3 text-right text-ink-2">{stop.count}</td>
            <td className="figure px-3 text-right whitespace-nowrap text-ink">{stop.p50 === null ? "–" : formatDuration(stop.p50)}</td>
            <td className="figure px-3 text-right whitespace-nowrap text-ink">{stop.p90 === null ? "–" : formatDuration(stop.p90)}</td>
            <td aria-hidden className="px-3 max-sm:hidden">
              <span className="relative block h-2 rounded-full bg-fill">
                {stop.p90 !== null && <span className="absolute inset-y-0 left-0 rounded-full bg-station-progress/35" style={{ width: `${(stop.p90 / slowest) * 100}%` }} />}
                {stop.p50 !== null && <span className="absolute inset-y-0 left-0 rounded-full bg-station-progress" style={{ width: `${(stop.p50 / slowest) * 100}%` }} />}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Where people hold the line longest, slowest first, with what waits there now. */
export function PeopleWaits({ insights }: { insights: Insights }) {
  if (insights.waits.length === 0) return <p className="text-sm text-muted">No stop on this line waits on a person.</p>;
  return (
    <ul className="divide-y divide-rule">
      {insights.waits.map((wait) => (
        <li key={wait.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
          <span className="font-semibold text-ink">{wait.name}</span>
          <span className="text-xs text-ink-2">
            Typically {time(wait.p50)}, slow {time(wait.p90)}
            {wait.waiting > 0 && <span className="font-semibold text-wait-ink"> · {pluralize(wait.waiting, "decision")} open now</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FlakyStops({ insights }: { insights: Insights }) {
  if (insights.flaky.length === 0) return <p className="text-sm text-muted">No stop failed and then passed on a retry.</p>;
  return (
    <ul className="divide-y divide-rule">
      {insights.flaky.map((stop) => (
        <li key={stop.id} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
          <span className="font-semibold text-ink">{stop.name}</span>
          <span className="text-xs text-wait-ink">
            Flaky in {stop.flaky} of {pluralize(stop.reached, "run")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Trip time run by run, oldest first: a bar per finished run, its height its trip time, failed ones in crimson. */
export function TripTrend({ insights, slug }: { insights: Insights; slug: string }) {
  if (insights.trend.length < 2) return <p className="text-sm text-muted">The trend fills in after a few finished runs.</p>;
  return (
    <figure>
      <ol aria-label="Trip time per finished run, oldest first" className="flex h-28 items-end gap-1 border-b border-rule">
        {insights.trend.map((run) => (
          <li key={run.id} className="flex h-full min-w-1.5 flex-1 items-end">
            <Link
              href={routes.pipelineRun(slug, run.id)}
              title={`Run ${run.number}: ${RUN_STATUS_META[run.status].label}, ${formatDuration(run.durationMs)}`}
              aria-label={`Run ${run.number}: ${RUN_STATUS_META[run.status].label}, ${formatDuration(run.durationMs)}`}
              className={cx("block w-full rounded-t-xs", run.status === "done" ? "bg-station-done" : "bg-late")}
              style={{ height: `${Math.max(4, run.share * 100)}%` }}
            />
          </li>
        ))}
      </ol>
      <figcaption className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-xs bg-station-done" />
          Reached an end
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-xs bg-late" />
          Failed
        </span>
      </figcaption>
    </figure>
  );
}
