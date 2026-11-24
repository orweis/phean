import { Workflow } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/cx";
import { STOP_VIEW_META } from "@/lib/domain";
import { routes } from "@/lib/routes";
import type { TaskLine } from "@/server/domain/pipelines";

import { StopDot } from "./stop-mark";

/**
 * Where a task sits on its pipeline's line: the run it carries (or the stop it serves), and that run's
 * stops in order as a strip of marks, this task's stop ringed and named "This task".
 */
export function TaskLineStrip({ line, slug }: { line: TaskLine; slug: string }) {
  return (
    <section aria-label="Pipeline" data-task-line className="space-y-2 rounded-lg border border-rule px-3 py-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
        <Workflow className="size-3.5" aria-hidden />
        {line.role === "run" ? "Carries" : "A stop of"}{" "}
        <Link href={routes.pipelineRun(slug, line.run.id)} className="font-semibold text-ink-2 link">
          {line.pipeline.name} #{line.run.number}
        </Link>
        <span aria-hidden>·</span>
        <span className="text-ink-2">{line.run.headline}</span>
      </p>
      <ol aria-label="Stops of the run" className="flex flex-wrap items-center gap-y-1.5">
        {line.stops.map((stop, index) => {
          const label = `${stop.name}: ${STOP_VIEW_META[stop.state].label}${stop.current ? " (this task)" : ""}`;
          const mark = <StopDot state={stop.state} size="sm" className={cx(stop.current && "ring-2 ring-accent ring-offset-2 ring-offset-panel")} />;
          return (
            <li key={stop.stopId} aria-current={stop.current ? "step" : undefined} className="flex items-center">
              {index > 0 && <span aria-hidden className="h-0.5 w-4 bg-edge" />}
              {stop.taskId && !stop.current ? (
                <Link href={routes.task(slug, stop.taskId)} scroll={false} aria-label={label} title={label} className="relative flex rounded-full after:absolute after:-inset-1.5">
                  {mark}
                </Link>
              ) : (
                <span title={label} className="flex items-center gap-1.5">
                  {mark}
                  <span className={stop.current ? "text-xs font-semibold text-ink" : "sr-only"}>{stop.current ? stop.name : label}</span>
                  {stop.current && <span className="sr-only"> (this task), {STOP_VIEW_META[stop.state].label}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
