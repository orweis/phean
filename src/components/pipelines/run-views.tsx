import { History } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/cx";
import type { DocumentRef } from "@/lib/documents";
import { RUN_STATUS_META, STOP_VIEW_META, type StopViewState } from "@/lib/domain";
import { formatDuration, timeAgo, truncate } from "@/lib/format";
import { stopViewState } from "@/lib/pipeline-map";
import { runTracks } from "@/lib/pipeline-stats";
import { routes } from "@/lib/routes";
import type { RunStopView, RunView } from "@/server/domain/pipelines";

import { DocumentChips } from "../documents/document-chips";
import { StopDot, StopStateBadge } from "./stop-mark";
import { AgentName, ResendHandoffButton, StuckBadge } from "./stuck";

/** Whether a stop's handoff can be resent: it still waits on the agent it was handed to, who can still act. */
export const resendable = (stop: RunStopView) => stop.kind === "agent" && Boolean(stop.handoff?.waiting && stop.handoff.agent);

const viewState = (stop: RunStopView): StopViewState => stopViewState(stop.state, stop.task?.status);

const tookOf = (stop: Pick<RunStopView, "startedAt" | "endedAt">, now: Date) => (stop.startedAt ? formatDuration((stop.endedAt ?? now).getTime() - stop.startedAt.getTime()) : null);

/** What the stop handed on, or why it stopped, in a line. */
export function outcomeOf(stop: RunStopView): string | null {
  if (stop.result?.answer) return `Decided “${stop.result.answer}”${stop.result.by ? ` (${stop.result.by})` : ""}`;
  if (stop.result?.note) return stop.result.note;
  if (stop.result?.outcome === "informed") return "Told, and the run went on";
  if (stop.reason && stop.state !== "upcoming") return stop.reason;
  return null;
}

/**
 * Compact (the run page's default): each stop in the order a run meets it, one line each, with its
 * state, who serves it, how long it took and what it handed on. Earlier attempts (reruns,
 * hand-backs) fold under the stop they repeat.
 */
export function CompactRun({ view, slug, selected, now, canAct = false }: { view: RunView; slug: string; selected: string | null; now: Date; canAct?: boolean }) {
  return (
    <ol data-run-compact className="divide-y divide-rule">
      {view.stops.map((stop) => {
        const state = viewState(stop);
        const earlier = view.history.filter((row) => row.stopId === stop.stopId);
        const took = state === "upcoming" ? null : tookOf(stop, now);
        const outcome = outcomeOf(stop);
        const isSelected = selected === stop.stopId;
        return (
          <li
            key={stop.stopId}
            data-stop-row={stop.stopId}
            data-selected={isSelected || undefined}
            aria-current={isSelected || undefined}
            className={cx(
              "relative px-5 py-3 before:absolute before:inset-y-2 before:left-1 before:w-1 before:rounded-full",
              isSelected ? "bg-accent-tint/35 before:bg-accent" : "before:bg-transparent",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StopDot state={state} size="sm" />
              <Link href={routes.pipelineRun(slug, view.run.id, { stop: stop.stopId })} scroll={false} className="text-sm font-semibold text-ink link">
                {stop.name}
              </Link>
              <span className="text-xs text-ink-2">{state === "waiting" && stop.waitingOn ? `Waiting on ${stop.waitingOn}` : STOP_VIEW_META[state].label}</span>
              <AgentName slug={slug} agent={stop.agent} fallback={stop.servedBy} className="text-xs text-muted" />
              {took && <span className="figure text-xs text-muted">{took}</span>}
              {stop.attempt > 1 && <span className="text-xs text-muted">attempt {stop.attempt}</span>}
              {stop.branch && <span className="text-xs text-ink-2">took “{stop.branch}”</span>}
              {stop.handoff?.stuck && <StuckBadge handoff={stop.handoff} now={now} />}
              {canAct && resendable(stop) && stop.handoff?.stuck && (
                <ResendHandoffButton slug={slug} runId={view.run.id} stopId={stop.stopId} stopName={stop.name} agentName={stop.handoff!.agent!.name} stuck />
              )}
            </div>
            {outcome && <p className="mt-1 line-clamp-2 pl-7 text-xs wrap-anywhere text-ink-2">{truncate(outcome, 240)}</p>}
            {earlier.length > 0 && (
              <details className="mt-1 pl-7">
                <summary className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-ink-2">
                  <History className="size-3" aria-hidden />
                  {earlier.length === 1 ? "1 earlier attempt" : `${earlier.length} earlier attempts`}
                </summary>
                <ul className="mt-1 space-y-1">
                  {earlier.map((row, index) => (
                    <li key={`${row.stopId}-${index}`} className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                      <StopDot state={viewState(row)} size="sm" />
                      {STOP_VIEW_META[viewState(row)].label}
                      {row.startedAt && <span className="text-muted">{timeAgo(row.startedAt)}</span>}
                      {outcomeOf(row) && <span className="wrap-anywhere">{truncate(outcomeOf(row)!, 160)}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** A track's line form by state: dashed while handing off or waiting, solid while worked, failed in crimson. */
const TRACK_FORM: Record<StopViewState, string> = {
  upcoming: "h-0 border-t-2 border-edge",
  handing_off: "h-0 border-t-2 border-dashed border-line-inbox",
  active: "h-1.5 rounded-full bg-station-progress",
  waiting: "h-0 border-t-2 border-dashed border-wait-ink",
  done: "h-1.5 rounded-full bg-station-done",
  failed: "h-1.5 rounded-full bg-late",
  skipped: "h-0 border-t-2 border-dotted border-edge",
  not_reached: "h-0 border-t-2 border-dotted border-edge",
  cancelled: "h-0 border-t-2 border-edge",
};

const clock = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

/**
 * The run as a timetable: one track per stop it reached, on an axis from the run's start to its end
 * (or now), dashed while waiting, solid while worked, a dot where it arrived.
 */
export function RunTimeline({ view, now }: { view: RunView; now: Date }) {
  const { tracks, spanMs } = runTracks(view.run, view.stops, now);
  if (tracks.length === 0) return <p className="px-5 py-6 text-sm text-muted">The run has not reached a stop yet.</p>;
  const byId = new Map(view.stops.map((stop) => [stop.stopId, stop]));
  return (
    <div data-run-timeline className="px-5 py-4 [--label:9rem] sm:[--label:12rem]">
      <p className="mb-2 flex justify-between gap-4 pl-[calc(var(--label)+1rem)] text-2xs text-muted max-sm:pl-0">
        <span>{clock.format(view.run.startedAt)} UTC</span>
        <span>
          {view.run.endedAt ? `${clock.format(view.run.endedAt)} UTC` : "Now"} · {formatDuration(spanMs)}
        </span>
      </p>
      <ol className="space-y-1">
        {tracks.map((track) => {
          const stop = byId.get(track.stopId)!;
          const state = viewState(stop);
          const took = tookOf(stop, now);
          return (
            <li key={track.stopId} data-task={stop.task?.id} className="grid grid-cols-1 items-center gap-x-4 sm:grid-cols-[var(--label)_minmax(0,1fr)]">
              <p className="min-w-0 truncate text-sm text-ink" title={stop.name}>
                {stop.name}
                <span className="sr-only">
                  : {STOP_VIEW_META[state].label}
                  {took ? `, ${took}` : ""}
                </span>
              </p>
              <div aria-hidden className="relative h-6 rounded-xs bg-fill/50">
                <span
                  data-segment={state}
                  className={cx("absolute top-1/2 -translate-y-1/2", TRACK_FORM[state])}
                  style={{ left: `${track.from * 100}%`, width: `${Math.max(0.5, (track.to - track.from) * 100)}%` }}
                />
                {state === "done" && <span data-end="arrived" className="absolute top-1/2 size-2.5 -translate-1/2 rounded-full bg-station-done ring-2 ring-panel" style={{ left: `${track.to * 100}%` }} />}
                {(state === "cancelled" || state === "failed") && <span data-end={state} className="absolute top-1/2 h-3.5 w-0.5 -translate-1/2 rotate-30 bg-muted" style={{ left: `${track.to * 100}%` }} />}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-muted">Run {RUN_STATUS_META[view.run.status].label.toLowerCase()}.</p>
    </div>
  );
}

/** The selected stop: where it stands, who serves it, what it handed on, and the way to its task. */
export function SelectedStop({ view, stopId, slug, now, actions, canAct = false }: { view: RunView; stopId: string; slug: string; now: Date; actions?: React.ReactNode; canAct?: boolean }) {
  const stop = view.stops.find((candidate) => candidate.stopId === stopId);
  if (!stop) return null;
  const state = viewState(stop);
  const took = state === "upcoming" ? null : tookOf(stop, now);
  const outcome = outcomeOf(stop);
  const documents: DocumentRef[] = (stop.result?.documents ?? []).map((doc) => ({ id: doc.id, title: doc.title, format: doc.format as DocumentRef["format"] }));
  return (
    <div data-selected-stop={stop.stopId} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-md font-semibold text-ink">{stop.name}</h2>
        <StopStateBadge state={state} waitingOn={stop.waitingOn} />
      </div>
      {stop.handoff?.stuck && <StuckBadge handoff={stop.handoff} now={now} />}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted">Served by</dt>
        <dd className="text-ink-2">
          <AgentName slug={slug} agent={stop.agent} fallback={stop.servedBy} />
        </dd>
        {stop.handoff && (
          <>
            <dt className="text-muted">Handed off</dt>
            <dd className="text-ink-2">
              {timeAgo(stop.handoff.handedOffAt)}
              {stop.handoff.resends > 0 && ` · resent ${stop.handoff.resends === 1 ? "once" : `${stop.handoff.resends} times`}`}
              {stop.handoff.nextRetryAt && state === "handing_off" && ` · next resend ${timeAgo(stop.handoff.nextRetryAt)}`}
            </dd>
          </>
        )}
        {stop.startedAt && state !== "skipped" && state !== "not_reached" && (
          <>
            <dt className="text-muted">Reached</dt>
            <dd className="text-ink-2">
              {timeAgo(stop.startedAt)}
              {took && ` · ${stop.endedAt ? "took" : "for"} ${took}`}
            </dd>
          </>
        )}
        {stop.attempt > 1 && (
          <>
            <dt className="text-muted">Attempt</dt>
            <dd className="text-ink-2">{stop.attempt}</dd>
          </>
        )}
        {stop.dueAt && !stop.endedAt && (
          <>
            <dt className="text-muted">Time limit</dt>
            <dd className="text-wait-ink">{timeAgo(stop.dueAt)}</dd>
          </>
        )}
        {stop.branch && (
          <>
            <dt className="text-muted">Took</dt>
            <dd className="text-ink-2">“{stop.branch}”</dd>
          </>
        )}
      </dl>
      {outcome && <p className="rounded-md bg-fill px-3 py-2 text-sm whitespace-pre-line wrap-anywhere text-ink-2">{truncate(outcome, 1200)}</p>}
      <DocumentChips documents={documents} slug={slug} max={10} />
      <div className="flex flex-wrap items-center gap-2">
        {stop.task && (
          <Link href={routes.task(slug, stop.task.id)} scroll={false} className="text-xs font-semibold text-accent-ink link">
            {state === "waiting" ? "Open the decision" : "Open its task"}
          </Link>
        )}
        {canAct && resendable(stop) && (
          <ResendHandoffButton slug={slug} runId={view.run.id} stopId={stop.stopId} stopName={stop.name} agentName={stop.handoff!.agent!.name} stuck={Boolean(stop.handoff?.stuck)} />
        )}
        {actions}
      </div>
    </div>
  );
}
