import Link from "next/link";

import { RUN_STATUS_META, RUN_TRIGGER_META } from "@/lib/domain";
import { formatDuration, timeAgo } from "@/lib/format";
import type { RunRecord } from "@/lib/pipeline-stats";
import type { PipelineDefinition } from "@/lib/pipelines";
import { routes } from "@/lib/routes";
import type { RunHistory } from "@/server/domain/pipelines";

import { MetaBadge } from "../ui/badge";
import { RUN_MARK } from "./run-strip";
import { StopDot } from "./stop-mark";

/** Which stops a live run waits at, by name. */
function waitingAt(run: RunRecord, definition: PipelineDefinition): string[] {
  return run.stops.filter((row) => !row.superseded && row.state === "waiting").map((row) => definition.stops.find((stop) => stop.id === row.stopId)?.name ?? row.stopId);
}

/** A pipeline's runs, newest first: number, how it started, when, how long, and how it ended or where it waits. */
export function RunList({ runs, definition, slug }: { runs: readonly RunHistory[]; definition: PipelineDefinition; slug: string }) {
  return (
    <ul className="divide-y divide-rule">
      {runs.map((run) => {
        const waiting = waitingAt(run, definition);
        return (
          <li key={run.id} data-run-row={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
            <StopDot state={RUN_MARK[run.status]} size="sm" />
            <Link href={routes.pipelineRun(slug, run.id)} className="text-sm font-semibold text-ink link">
              Run #{run.number}
            </Link>
            <MetaBadge meta={RUN_STATUS_META} value={run.status} />
            <span className="text-xs text-muted">
              {RUN_TRIGGER_META[run.trigger].label}
              {run.trigger === "manual" || run.trigger === "agent" ? ` (${run.triggeredByName})` : ""}, {timeAgo(run.startedAt)}
            </span>
            {run.endedAt && <span className="figure text-xs text-ink-2">{formatDuration(run.endedAt.getTime() - run.startedAt.getTime())}</span>}
            {run.endName && <span className="text-xs text-ink-2">Ended: {run.endName}</span>}
            {waiting.length > 0 && <span className="text-xs font-semibold text-wait-ink">Waiting at {waiting.join(", ")}</span>}
            {run.version !== undefined && <span className="text-xs text-muted">v{run.version}</span>}
          </li>
        );
      })}
    </ul>
  );
}
