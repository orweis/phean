import Link from "next/link";

import { RUN_STATUS_META, type RunStatus, type StopViewState } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { formatDuration } from "@/lib/format";
import { routes } from "@/lib/routes";

import { StopDot } from "./stop-mark";

/** A run's status drawn with the stop marks: live runs as work in motion or waiting, ended ones by how they ended. */
export const RUN_MARK: Record<RunStatus, StopViewState> = { running: "active", waiting: "waiting", done: "done", failed: "failed", cancelled: "cancelled" };

interface StripRun {
  id: string;
  number: number;
  status: RunStatus;
  startedAt: Date;
  endedAt: Date | null;
}

/** "Run 12: Done in 3 h", for a dot's name. */
export function runLabel(run: StripRun): string {
  const took = run.endedAt ? ` in ${formatDuration(run.endedAt.getTime() - run.startedAt.getTime())}` : "";
  return `Run ${run.number}: ${RUN_STATUS_META[run.status].label}${run.status === "done" || run.status === "failed" ? took : ""}`;
}

/** The latest runs of a pipeline as a row of dots, oldest first, each a link to its run. */
export function RunStrip({ runs, slug, className }: { runs: readonly StripRun[]; slug: string; className?: string }) {
  if (runs.length === 0) return <p className={cx("text-xs text-muted", className)}>No runs yet</p>;
  const oldestFirst = [...runs].sort((a, b) => a.number - b.number);
  return (
    <ol aria-label={`Last ${runs.length === 1 ? "run" : `${runs.length} runs`}`} data-run-strip className={cx("flex flex-wrap items-center gap-1", className)}>
      {oldestFirst.map((run) => (
        <li key={run.id}>
          <Link
            href={routes.pipelineRun(slug, run.id)}
            aria-label={runLabel(run)}
            title={runLabel(run)}
            data-run={run.status}
            className="relative flex rounded-full after:absolute after:-inset-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <StopDot state={RUN_MARK[run.status]} size="sm" />
          </Link>
        </li>
      ))}
    </ol>
  );
}
