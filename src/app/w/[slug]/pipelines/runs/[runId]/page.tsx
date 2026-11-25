import { Activity as ActivityIcon, ChevronRight, CircleStop, Clock3, ListOrdered, PenLine, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { cancelRunAction, rerunFromAction, updateRunAction } from "@/app/w/[slug]/actions";
import { ActivityFeed } from "@/components/activity-feed";
import { LineMap } from "@/components/charts/line-map";
import { CompactRun, RunTimeline, SelectedStop } from "@/components/pipelines/run-views";
import { StopLegend } from "@/components/pipelines/stop-legend";
import { TrackedLink } from "@/components/tracked-link";
import { ActionButton } from "@/components/ui/action-button";
import { ActionForm } from "@/components/ui/action-form";
import { MetaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ChipRail } from "@/components/ui/chip-rail";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { Field, Input, Select } from "@/components/ui/field";
import { Popover, PopoverCancel } from "@/components/ui/popover";
import { segment, SEGMENTED } from "@/components/ui/segmented";
import { SubmitButton } from "@/components/ui/submit-button";
import { cx } from "@/lib/cx";
import { isOneOf, LIMITS, LIVE_RUN_STATUSES, RUN_STATUS_META, RUN_TRIGGER_META } from "@/lib/domain";
import { formatDuration, timeAgo } from "@/lib/format";
import { stopViewState } from "@/lib/pipeline-map";
import { focusStopOf } from "@/lib/pipeline-stats";
import { runLabel, runTitle } from "@/lib/pipelines";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { getRun, getRunActivity, type RunView } from "@/server/domain/pipelines";
import { can } from "@/server/domain/policy";
import { orNotFound } from "@/server/web";

const VIEWS = [
  { key: "compact", label: "Compact", icon: ListOrdered },
  { key: "timeline", label: "Timeline", icon: Clock3 },
  { key: "activity", label: "Activity", icon: ActivityIcon },
] as const;
type RunPageView = (typeof VIEWS)[number]["key"];

const loadRun = cache(async (slug: string, runId: string) => {
  const { ctx } = await requireWorkspace(slug);
  return orNotFound(getRun(ctx, { runId }));
});

export async function generateMetadata({ params }: PageProps<"/w/[slug]/pipelines/runs/[runId]">): Promise<Metadata> {
  const { slug, runId } = await params;
  const view = await loadRun(slug, runId);
  return { title: runTitle(view.run, view.pipeline.name) };
}

/** The stops a run can go again from: those it reached. */
const rerunnable = (view: RunView) => view.stops.filter((stop) => stop.state !== "upcoming" && stop.state !== "skipped" && stop.state !== "not_reached");

function RerunFrom({ view, slug }: { view: RunView; slug: string }) {
  const stops = rerunnable(view);
  if (stops.length === 0) return null;
  const preferred = focusStopOf(view.stops);
  return (
    <Popover variant="secondary" icon={<RotateCcw aria-hidden />} label="Re-run from a stop" title="Re-run from a stop" className="sm:w-80">
      <ActionForm
        action={rerunFromAction}
        workspace={slug}
        confirm="Run this stop and every stop after it again? Their tasks under way are dropped and handed out afresh."
        notice={`${runLabel(view.run, view.pipeline.name)} runs again`}
        analytics={{ event: "run_rerun_from" }}
        closeOnSuccess
        className="space-y-3"
      >
        <input type="hidden" name="runId" value={view.run.id} />
        <Field label="From" htmlFor="rerun-stop">
          <Select id="rerun-stop" name="stopId" defaultValue={stops.some((stop) => stop.stopId === preferred) ? preferred! : stops[0]!.stopId}>
            {stops.map((stop) => (
              <option key={stop.stopId} value={stop.stopId}>
                {stop.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What to do differently" htmlFor="rerun-note" hint="Added to the stop's handoff note.">
          <Input id="rerun-note" name="note" maxLength={LIMITS.note} />
        </Field>
        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="primary">
            Re-run
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}

/** Names the run after what it makes, or clears its name. */
function RenameRun({ view, slug }: { view: RunView; slug: string }) {
  return (
    <Popover variant="ghost" icon={<PenLine aria-hidden />} label="Rename" triggerLabel="Rename this run" title="Rename the run" className="sm:w-80">
      <ActionForm
        action={updateRunAction}
        workspace={slug}
        notice="Renamed the run"
        analytics={{ event: "run_rename" }}
        closeOnSuccess
        className="space-y-3"
      >
        <input type="hidden" name="runId" value={view.run.id} />
        <Field label="Name" htmlFor="run-name" hint={`What this run makes. Leave it empty to show it as ${view.pipeline.name} #${view.run.number}.`}>
          <Input id="run-name" name="name" defaultValue={view.run.name ?? ""} maxLength={LIMITS.runName} placeholder="Issue 42: AI agents roundup" />
        </Field>
        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="primary">
            Save
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}

export default async function RunPage({ params, searchParams }: PageProps<"/w/[slug]/pipelines/runs/[runId]">) {
  const { slug, runId } = await params;
  const query = await searchParams;
  const viewParam = queryParam(query.view);
  const current: RunPageView = isOneOf(VIEWS.map((entry) => entry.key), viewParam) ? viewParam : "compact";
  const { ctx } = await requireWorkspace(slug);
  const view = await loadRun(slug, runId);
  const activity = current === "activity" ? await getRunActivity(ctx, { runId }) : [];
  const { run, pipeline } = view;
  const now = new Date();
  const live = (LIVE_RUN_STATUSES as readonly string[]).includes(run.status);
  const canAct = can(ctx.actor, "pipeline:write");
  const stopParam = queryParam(query.stop);
  const selected = view.stops.some((stop) => stop.stopId === stopParam) ? stopParam! : focusStopOf(view.stops);
  const states = Object.fromEntries(view.stops.map((stop) => [stop.stopId, { state: stopViewState(stop.state, stop.task?.status), raw: stop.state, branch: stop.branch, stuck: Boolean(stop.handoff?.stuck) }]));
  const label = runLabel(run, pipeline.name);
  const selectedStop = view.stops.find((stop) => stop.stopId === selected);
  const canRerunSelected = canAct && run.status !== "cancelled" && selectedStop && rerunnable(view).includes(selectedStop);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
          <li>
            <Link href={routes.pipelines(slug)} className="hover:text-ink link">
              Pipelines
            </Link>
          </li>
          <li className="flex items-center gap-1">
            <ChevronRight className="size-3 text-faint" aria-hidden />
            <Link href={routes.pipeline(slug, pipeline.id, { tab: "runs" })} className="max-w-48 truncate hover:text-ink link">
              {pipeline.name}
            </Link>
          </li>
          <li className="flex items-center gap-1">
            <ChevronRight className="size-3 text-faint" aria-hidden />
            <span aria-current="page" className="max-w-64 truncate text-ink-2">
              {label}
            </span>
          </li>
        </ol>
      </nav>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-2xl font-bold wrap-anywhere text-ink">{label}</h1>
            <MetaBadge meta={RUN_STATUS_META} value={run.status} />
          </div>
          <p data-run-headline className="mt-1.5 text-md font-semibold text-ink-2">
            {view.headline}
          </p>
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
            {run.name && (
              <span>
                {pipeline.name} #{run.number}
              </span>
            )}
            <span>Version {run.version}</span>
            <span>
              {RUN_TRIGGER_META[run.trigger].label}
              {run.trigger === "manual" || run.trigger === "agent" ? ` (${run.triggeredByName})` : ""} {timeAgo(run.startedAt)}
            </span>
            <span>
              {run.endedAt ? "Took" : "Under way for"} {formatDuration((run.endedAt ?? now).getTime() - run.startedAt.getTime())}
            </span>
            {run.task && (
              <Link href={routes.task(slug, run.task.id)} scroll={false} className="font-semibold text-ink-2 link">
                The run&apos;s task
              </Link>
            )}
          </p>
          {run.summary && run.status !== "done" && <p className="mt-1.5 max-w-3xl text-sm text-ink-2">{run.summary}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canAct && <RenameRun view={view} slug={slug} />}
          {canAct && run.status !== "cancelled" && <RerunFrom view={view} slug={slug} />}
          {canAct && live && (
            <ActionButton
              action={cancelRunAction}
              workspace={slug}
              fields={{ runId: run.id }}
              confirm={`Cancel ${label}? Its stops under way stop, their tasks are dropped, and it cannot go on.`}
              notice={`Cancelled ${label}`}
              analytics={{ event: "run_cancel" }}
              size="sm"
              variant="danger"
            >
              <CircleStop aria-hidden />
              Cancel run
            </ActionButton>
          )}
          <CopyLinkButton path={routes.pipelineRun(slug, run.id)} subject="link to this run" />
        </div>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Line" description="This run's stops on the line. Choose a stop in the list below to see it here." />
          <CardBody className="space-y-4">
            <LineMap
              definition={view.definition}
              label={`${pipeline.name}'s line, with ${label}`}
              servedBy={Object.fromEntries(view.stops.map((stop) => [stop.stopId, stop.servedBy]))}
              agents={Object.fromEntries(view.stops.flatMap((stop) => (stop.agent ? [[stop.stopId, stop.agent]] : [])))}
              slug={slug}
              states={states}
              reachedEnd={run.endId}
              hrefOf={Object.fromEntries(view.stops.map((stop) => [stop.stopId, routes.pipelineRun(slug, run.id, { stop: stop.stopId })]))}
              selected={selected}
            />
            <StopLegend />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Selected stop" />
          <CardBody>
            {selected && (
              <SelectedStop
                view={view}
                stopId={selected}
                slug={slug}
                now={now}
                canAct={canAct}
                actions={
                  canRerunSelected && (
                    <ActionButton
                      action={rerunFromAction}
                      workspace={slug}
                      fields={{ runId: run.id, stopId: selectedStop!.stopId }}
                      confirm={`Run “${selectedStop!.name}” and every stop after it again?`}
                      notice={`Re-running from “${selectedStop!.name}”`}
                      analytics={{ event: "run_rerun_from" }}
                      size="sm"
                      variant="ghost"
                    >
                      <RotateCcw aria-hidden />
                      Re-run from here
                    </ActionButton>
                  )
                }
              />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Trip"
          action={
            <ChipRail label="Run views" selected={current} className={cx(SEGMENTED, "w-fit max-w-full")}>
              {VIEWS.map(({ key, label, icon: Icon }) => (
                <TrackedLink
                  key={key}
                  href={routes.pipelineRun(slug, run.id, { view: key === "compact" ? undefined : key, stop: stopParam })}
                  analytics={key === current ? undefined : { event: "run_view", params: { view: key } }}
                  scroll={false}
                  aria-current={key === current ? "page" : undefined}
                  className={cx(segment(key === current), "inline-flex items-center gap-1.5 whitespace-nowrap")}
                >
                  <Icon aria-hidden className="size-3.5" />
                  {label}
                </TrackedLink>
              ))}
            </ChipRail>
          }
        />
        {current === "compact" && <CompactRun view={view} slug={slug} selected={selected} now={now} canAct={canAct} />}
        {current === "timeline" && <RunTimeline view={view} now={now} />}
        {current === "activity" && (
          <CardBody>
            <ActivityFeed events={activity} slug={slug} shown={30} />
          </CardBody>
        )}
      </Card>
    </>
  );
}
