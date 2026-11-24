import Link from "next/link";

import { cx } from "@/lib/cx";
import { RUN_STATUS_META, STOP_VIEW_META } from "@/lib/domain";
import { formatDuration } from "@/lib/format";
import type { RunGrid as Grid } from "@/lib/pipeline-stats";
import { routes } from "@/lib/routes";

import { ScrollX } from "../ui/scroll-x";
import { PINNED_CELL, TH } from "../ui/table";
import { StopDot } from "./stop-mark";

/**
 * Runs × stops: one row per stop and one column per run, newest at the left, so a stop that keeps
 * failing or keeps waiting on a person stands out across a row. Each cell is the stop's mark in that
 * run, its state and time in words for screen readers and on hover.
 */
export function RunGrid({ grid, slug }: { grid: Grid; slug: string }) {
  return (
    <ScrollX className="relative">
      <table data-run-grid className="w-full border-collapse text-sm">
        <caption className="sr-only">Each stop&apos;s state in each run, newest run first</caption>
        <thead>
          <tr className="border-b border-rule">
            <th scope="col" className={cx(TH, PINNED_CELL, "text-left")}>
              Stop
            </th>
            {grid.runs.map((run) => (
              <th key={run.id} scope="col" className={cx(TH, "px-1 text-center")}>
                <Link href={routes.pipelineRun(slug, run.id)} className="link" aria-label={`Run ${run.number}, ${RUN_STATUS_META[run.status].label}`}>
                  #{run.number}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.stops.map((stop) => (
            <tr key={stop.id} data-grid-stop={stop.id} className="border-b border-rule last:border-b-0">
              <th scope="row" className={cx(PINNED_CELL, "max-w-48 truncate px-3 py-2 text-left text-xs font-semibold text-ink")} title={stop.name}>
                {stop.name}
              </th>
              {grid.cells[stop.id]!.map((cell) => {
                const words = `${STOP_VIEW_META[cell.state].label}${cell.durationMs !== null ? `, ${formatDuration(cell.durationMs)}` : ""}${cell.attempts > 1 ? `, ${cell.attempts} attempts` : ""}`;
                return (
                  <td key={cell.runId} data-cell={cell.state} className="px-1 py-2 text-center" title={words}>
                    <span className="relative inline-flex">
                      <StopDot state={cell.state} size="sm" />
                      {cell.attempts > 1 && <span aria-hidden className="absolute -top-1.5 -right-2 text-2xs font-bold text-ink-2">{cell.attempts}</span>}
                    </span>
                    <span className="sr-only">{words}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}
