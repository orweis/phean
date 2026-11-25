import { CalendarClock, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { OpenQuestions } from "@/components/open-questions";
import { PageHeader } from "@/components/page-header";
import { NewPipeline } from "@/components/pipelines/new-pipeline";
import { PipelineFilters } from "@/components/pipelines/pipeline-filters";
import { RunStrip } from "@/components/pipelines/run-strip";
import { RunsFilter } from "@/components/pipelines/runs-filter";
import { AgentName, StuckBadge } from "@/components/pipelines/stuck";
import { StartRun } from "@/components/pipelines/start-run";
import { KIND_ICON } from "@/components/pipelines/stop-mark";
import { Badge, MetaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { isOneOf, PIPELINE_KINDS, PIPELINE_STATUS_META, PIPELINE_STATUSES, RUN_STATUS_META } from "@/lib/domain";
import { formatDuration, percent, pluralize, timeAgo } from "@/lib/format";
import { percentile } from "@/lib/pipeline-stats";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { describePipelineRequests, listPipelineBoard, listStuckStops, type PipelineBoardRow, type StuckStop } from "@/server/domain/pipelines";
import { runLabel } from "@/lib/pipelines";
import { can } from "@/server/domain/policy";
import { listDecisions } from "@/server/domain/tasks";

export const metadata: Metadata = { title: "Pipelines" };

/** Success rate and typical trip time over the runs on the strip. */
function stripStats(row: PipelineBoardRow) {
  const finished = row.strip.filter((run) => run.status === "done" || run.status === "failed");
  const trips = row.strip.filter((run) => run.status === "done" && run.endedAt).map((run) => run.endedAt!.getTime() - run.startedAt.getTime());
  return { rate: finished.length ? finished.filter((run) => run.status === "done").length / finished.length : null, median: percentile(trips, 0.5) };
}

/** The pipeline's stops as a small line of actor marks. */
function SmallLine({ row }: { row: PipelineBoardRow }) {
  return (
    <ol aria-label={`Stops: ${row.line.map((stop) => stop.name).join(", ")}`} className="flex items-center">
      {row.line.map((stop, index) => {
        const Icon = KIND_ICON[stop.kind];
        return (
          <li key={stop.id} className="flex items-center" title={stop.name}>
            {index > 0 && <span aria-hidden className="h-0.5 w-3 bg-edge" />}
            <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-full border-2 border-edge bg-panel text-ink-2 [&_svg]:size-3">
              <Icon />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PipelineRow({ row, slug, canStart, stuck }: { row: PipelineBoardRow; slug: string; canStart: boolean; stuck: number }) {
  const { rate, median } = stripStats(row);
  const quiet = row.status !== "active";
  return (
    <li data-pipeline={row.id} className="grid gap-x-6 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0 space-y-1.5">
        <p className="flex flex-wrap items-center gap-2">
          <Link href={routes.pipeline(slug, row.id)} className={quiet ? "text-sm font-semibold text-muted link" : "text-sm font-semibold text-ink link"}>
            {row.name}
          </Link>
          {row.status !== "active" && <MetaBadge meta={PIPELINE_STATUS_META} value={row.status} />}
          {row.runs.waiting > 0 && (
            <Badge tone="warning">{pluralize(row.runs.waiting, "run")} waiting on a person</Badge>
          )}
          {stuck > 0 && (
            <Link href={routes.pipeline(slug, row.id, { tab: "runs", runs: "stuck" })} className="text-xs font-semibold text-late-ink link">
              {pluralize(stuck, "run")} stuck
            </Link>
          )}
        </p>
        <SmallLine row={row} />
        <p className="flex flex-wrap gap-x-3 text-xs text-muted">
          <span>{pluralize(row.runs.total, "run")}</span>
          {rate !== null && <span>{percent(rate)} reach an end</span>}
          {median !== null && <span>Typical trip {formatDuration(median)}</span>}
          {row.schedule && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden />
              {row.nextRunAt ? `Next run ${timeAgo(row.nextRunAt)}` : row.status === "active" ? "On a schedule" : "Schedule paused"}
            </span>
          )}
        </p>
      </div>
      <RunStrip runs={row.strip} slug={slug} />
      <div className="flex items-center gap-2">
        {canStart && row.status === "active" && <StartRun slug={slug} pipelineId={row.id} name={row.name} inputs={row.inputs} />}
      </div>
    </li>
  );
}

/** Every stop whose handoff no one picked up: where, who it waits on, since when, and how often it was resent. */
function StuckStops({ stops, slug, now }: { stops: readonly StuckStop[]; slug: string; now: Date }) {
  return (
    <Card id="stuck">
      <CardHeader title="Stuck handoffs" description="Stops whose agent has not picked up the handoff. Phean resends it with backoff for 3 days, then leaves it to you: open the run to resend it or hand it to someone." />
      {stops.length === 0 ? (
        <EmptyState icon={<Workflow />} title="Nothing stuck">
          Every handoff was picked up.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-rule">
          {stops.map((stop) => (
            <li key={`${stop.runId}:${stop.stopId}`} data-stuck-stop={stop.stopId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
              <Link href={routes.pipelineRun(slug, stop.runId, { stop: stop.stopId })} className="text-sm font-semibold wrap-anywhere text-ink link">
                {runLabel({ name: stop.runName, number: stop.runNumber }, stop.pipelineName)}
              </Link>
              <span className="text-xs text-muted">{stop.runName ? `${stop.pipelineName} #${stop.runNumber} · ` : ""}at {stop.stopName}</span>
              <StuckBadge handoff={stop} now={now} />
              <span className="text-xs text-ink-2">
                Waits on <AgentName slug={slug} agent={stop.agent} fallback="an agent that is gone" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function PipelinesPage({ params, searchParams }: PageProps<"/w/[slug]/pipelines">) {
  const { slug } = await params;
  const query = await searchParams;
  const kindParam = queryParam(query.kind);
  const statusParam = queryParam(query.status);
  const kind = isOneOf(PIPELINE_KINDS, kindParam) ? kindParam : undefined;
  const status = isOneOf(PIPELINE_STATUSES, statusParam) ? statusParam : undefined;
  const onlyStuck = queryParam(query.runs) === "stuck";
  const { ctx } = await requireWorkspace(slug);
  const [rows, finishedAdhoc, { open }] = await Promise.all([
    listPipelineBoard(ctx, { kind, status }),
    status || kind === "regular" ? Promise.resolve([]) : listPipelineBoard(ctx, { kind: "adhoc", status: "archived", limit: 10 }),
    listDecisions(ctx, {}),
  ]);
  const stuck = await listStuckStops(ctx, {});
  const stuckRuns = (pipelineId: string) => new Set(stuck.filter((stop) => stop.pipelineId === pipelineId).map((stop) => stop.runId)).size;
  const waiting = open.filter((task) => task.inputRequest?.pipeline);
  const contexts = waiting.length
    ? await describePipelineRequests(ctx, { requests: waiting.map((task) => ({ runId: task.inputRequest!.pipeline!.runId, stopId: task.inputRequest!.pipeline!.stopId })) })
    : {};
  const shown = onlyStuck ? rows.filter((row) => stuckRuns(row.id) > 0) : rows;
  const regular = shown.filter((row) => row.kind === "regular");
  const adhoc = [...shown.filter((row) => row.kind === "adhoc"), ...(onlyStuck ? [] : finishedAdhoc)];
  const canStart = can(ctx.actor, "pipeline:write");
  const filtered = Boolean(kind || status || onlyStuck);

  return (
    <>
      <PageHeader
        title="Pipelines"
        description="Lines of stops that work rides along by handoff: each stop is served by an agent or a person, and Phean hands the work on when a stop finishes. Agents define most pipelines over MCP; a run is one trip down the line."
        actions={
          <>
            <PipelineFilters />
            <RunsFilter stuck={new Set(stuck.map((stop) => stop.runId)).size} />
            {canStart && <NewPipeline slug={slug} />}
          </>
        }
      />
      <div className="space-y-6">
        {waiting.length > 0 && (
          <Card id="waiting" tone="wait">
            <CardHeader tone="wait" title={`${pluralize(waiting.length, "run")} waiting on a person`} description="Pipeline decisions, longest waiting first. Answer here or on Decisions." />
            <CardBody className="py-1">
              <OpenQuestions tasks={waiting} slug={slug} canAnswer={can(ctx.actor, "task:write")} pipelines={contexts} via="pipeline_card" />
            </CardBody>
          </Card>
        )}
        {onlyStuck && <StuckStops stops={stuck} slug={slug} now={new Date()} />}
        {(kind !== "adhoc" || regular.length > 0) && (
          <Card>
            <CardHeader title="Regular pipelines" description="Repeating workloads, started by a schedule, an event, an agent or you. Each dot is a run, oldest first." />
            {regular.length === 0 ? (
              <EmptyState icon={<Workflow />} title={filtered ? "No pipelines match" : "No pipelines yet"}>
                Ask a connected agent to define one with define_pipeline (“Claude researches, I approve, Grok sends”), or start from a template with New pipeline.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-rule">
                {regular.map((row) => (
                  <PipelineRow key={row.id} row={row} slug={slug} canStart={canStart} stuck={stuckRuns(row.id)} />
                ))}
              </ul>
            )}
          </Card>
        )}
        {adhoc.length > 0 && (
          <Card>
            <CardHeader title="Recent ad hoc" description="One-off jobs split between a few actors; each runs once." />
            <ul className="divide-y divide-rule">
              {adhoc.map((row) => (
                <li key={row.id} data-pipeline={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={routes.pipeline(slug, row.id)} className="text-sm font-semibold text-ink link">
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted">{row.line.map((stop) => stop.name).join(" → ")}</p>
                  </div>
                  {row.lastRun ? (
                    <Link href={routes.pipelineRun(slug, row.lastRun.id)} className="text-xs font-semibold text-ink-2 link">
                      {RUN_STATUS_META[row.lastRun.status].label}, {timeAgo(row.lastRun.startedAt)}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted">Not started</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
