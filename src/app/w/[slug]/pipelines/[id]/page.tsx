import { Archive, Bot, CalendarClock, ChevronRight, Ellipsis, Map as MapIcon, Pause, Play, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { approvePipelineVersionAction, archivePipelineAction, pausePipelineAction, rejectPipelineVersionAction, resumePipelineAction } from "@/app/w/[slug]/actions";
import { LineMap } from "@/components/charts/line-map";
import { FlakyStops, InsightStats, PeopleWaits, StopTimesTable, TripTrend } from "@/components/pipelines/insights";
import { PipelineEditor } from "@/components/pipelines/pipeline-editor";
import { PipelineTabs, type PipelineTab } from "@/components/pipelines/pipeline-tabs";
import { RunGrid } from "@/components/pipelines/run-grid";
import { RunList } from "@/components/pipelines/run-list";
import { StartRun } from "@/components/pipelines/start-run";
import { StopLegend } from "@/components/pipelines/stop-legend";
import { TriggersForm } from "@/components/pipelines/triggers-form";
import { ActionButton } from "@/components/ui/action-button";
import { ActionForm } from "@/components/ui/action-form";
import { MetaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { Field, Input } from "@/components/ui/field";
import { Popover, PopoverCancel } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { isOneOf, LIMITS, PIPELINE_KIND_META, PIPELINE_STATUS_META, PROPOSAL_STATE_META } from "@/lib/domain";
import { pluralize, timeAgo } from "@/lib/format";
import { stopViewState } from "@/lib/pipeline-map";
import { definitionDiff, pipelineInsights, runGrid } from "@/lib/pipeline-stats";
import type { PipelineDefinition } from "@/lib/pipelines";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listAgents } from "@/server/domain/agents";
import { canChangeRegular, getPipeline, getPipelineVersion, getRun, pipelineHistory, stopsServedBy, type PipelineVersion } from "@/server/domain/pipelines";
import { can } from "@/server/domain/policy";
import { listMembers } from "@/server/domain/tenants";
import { absoluteUrl, orNotFound } from "@/server/web";

const TABS = ["map", "runs", "insights", "definition"] as const;

const loadPipeline = cache(async (slug: string, pipelineId: string) => {
  const { ctx } = await requireWorkspace(slug);
  return orNotFound(getPipeline(ctx, { pipelineId }));
});

export async function generateMetadata({ params }: PageProps<"/w/[slug]/pipelines/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const { pipeline } = await loadPipeline(slug, id);
  return { title: pipeline.name };
}

/** What changed in a version, against the one it was written from. */
function VersionChanges({ before, after }: { before: PipelineDefinition | null; after: PipelineDefinition }) {
  if (!before) return <p className="text-sm text-muted">The first version.</p>;
  const changes = definitionDiff(before, after);
  if (changes.length === 0) return <p className="text-sm text-muted">No change to the stops; only the name, description or triggers.</p>;
  return (
    <ul data-diff className="list-disc space-y-0.5 pl-5 text-sm text-ink-2">
      {changes.map((change) => (
        <li key={change}>{change}</li>
      ))}
    </ul>
  );
}

function Proposal({ slug, proposal, base, canDecide }: { slug: string; proposal: PipelineVersion; base: PipelineDefinition | null; canDecide: boolean }) {
  return (
    <li data-proposal={proposal.number} className="space-y-2 py-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-ink">Version {proposal.number}</span>
        <MetaBadge meta={PROPOSAL_STATE_META} value="proposed" />
        <span className="flex items-center gap-1 text-xs text-muted">
          <Bot className="size-3" aria-hidden />
          {proposal.createdByName}, {timeAgo(proposal.createdAt)}, from version {proposal.baseVersion}
        </span>
      </p>
      {proposal.reason && <blockquote className="border-l-2 border-wait pl-3 text-sm text-ink">{proposal.reason}</blockquote>}
      <VersionChanges before={base} after={proposal.definition} />
      {canDecide && (
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            action={approvePipelineVersionAction}
            workspace={slug}
            fields={{ pipelineId: proposal.pipelineId, version: String(proposal.number) }}
            notice={`Approved version ${proposal.number}; new runs ride it`}
            analytics={{ event: "proposal_decide", params: { result: "approve" } }}
            size="sm"
            variant="tinted"
          >
            Approve
          </ActionButton>
          <Popover variant="ghost" label="Reject" title={`Reject version ${proposal.number}`} align="left">
            <ActionForm
              action={rejectPipelineVersionAction}
              workspace={slug}
              notice={`Rejected version ${proposal.number}`}
              analytics={{ event: "proposal_decide", params: { result: "reject" } }}
              closeOnSuccess
              className="space-y-3"
            >
              <input type="hidden" name="pipelineId" value={proposal.pipelineId} />
              <input type="hidden" name="version" value={proposal.number} />
              <Field label="Why" htmlFor={`reject-${proposal.number}`} hint={`${proposal.createdByName} reads this.`}>
                <Input id={`reject-${proposal.number}`} name="note" maxLength={LIMITS.note} />
              </Field>
              <div className="flex items-center gap-2">
                <SubmitButton size="sm" variant="primary">
                  Reject
                </SubmitButton>
                <PopoverCancel />
              </div>
            </ActionForm>
          </Popover>
        </div>
      )}
    </li>
  );
}

export default async function PipelinePage({ params, searchParams }: PageProps<"/w/[slug]/pipelines/[id]">) {
  const { slug, id } = await params;
  const query = await searchParams;
  const tabParam = queryParam(query.tab);
  const tab: PipelineTab = isOneOf(TABS, tabParam) ? tabParam : "map";
  const { ctx } = await requireWorkspace(slug);
  const detail = await loadPipeline(slug, id);
  const { pipeline, definition, versions, proposals, triggers, recentRuns } = detail;
  const canStart = can(ctx.actor, "pipeline:write");
  const canChange = pipeline.status !== "archived" && (pipeline.kind === "adhoc" ? canStart : canChangeRegular(ctx, pipeline));
  const servedBy = await stopsServedBy(ctx, definition);
  const now = new Date();

  const latest = tab === "map" && recentRuns[0] ? await getRun(ctx, { runId: recentRuns[0].id }) : null;
  const latestOnCurrent = latest && latest.run.version === pipeline.currentVersion;
  const history = tab === "runs" || tab === "insights" ? await pipelineHistory(ctx, { pipelineId: pipeline.id, limit: 50 }) : [];
  const baseOf = async (number: number | null) => (number ? (await getPipelineVersion(ctx, { pipelineId: pipeline.id, version: number })).definition : null);
  const proposalBases = tab === "insights" || tab === "definition" ? await Promise.all(proposals.map((proposal) => baseOf(proposal.baseVersion))) : [];
  const versionParam = Number(queryParam(query.version));
  const shown = tab === "definition" && versionParam ? await getPipelineVersion(ctx, { pipelineId: pipeline.id, version: versionParam }).catch(() => null) : null;
  const shownBase = shown ? await baseOf(shown.baseVersion ?? (versions.find((version) => version.number < shown.number && version.proposalState !== "proposed" && version.proposalState !== "rejected")?.number ?? null)) : null;
  const [agents, members] = tab === "definition" && canChange ? await Promise.all([listAgents(ctx, {}), listMembers(ctx, {})]) : [[], []];

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
          <li>
            <Link href={routes.pipelines(slug)} className="hover:text-ink link">
              Pipelines
            </Link>
          </li>
          <li className="flex min-w-0 items-center gap-1">
            <ChevronRight className="size-3 text-faint" aria-hidden />
            <span aria-current="page" className="max-w-64 truncate text-ink-2">
              {pipeline.name}
            </span>
          </li>
        </ol>
      </nav>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-2xl font-bold text-ink">{pipeline.name}</h1>
            <MetaBadge meta={PIPELINE_KIND_META} value={pipeline.kind} />
            <MetaBadge meta={PIPELINE_STATUS_META} value={pipeline.status} />
          </div>
          {pipeline.description && <p className="mt-1.5 max-w-3xl text-sm whitespace-pre-line text-ink-2">{pipeline.description}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-muted">
            <span>
              Version {pipeline.currentVersion} · {pluralize(definition.stops.length, "stop")} · defined by {pipeline.createdByName} {timeAgo(pipeline.createdAt)}
            </span>
            {triggers.schedule && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3" aria-hidden />
                <code className="font-mono">{triggers.schedule.cron}</code> ({triggers.schedule.timeZone})
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canStart && pipeline.status === "active" && pipeline.kind === "regular" && <StartRun slug={slug} pipelineId={pipeline.id} name={pipeline.name} inputs={definition.inputs} variant="primary" />}
          <CopyLinkButton path={routes.pipeline(slug, pipeline.id)} subject="link to this pipeline" />
          {canChange && (
            <Popover menu variant="ghost" label={<Ellipsis aria-hidden />} triggerLabel={`More actions for ${pipeline.name}`} triggerClassName="px-2">
              {pipeline.status === "active" ? (
                <ActionButton
                  action={pausePipelineAction}
                  workspace={slug}
                  fields={{ pipelineId: pipeline.id }}
                  notice={`Paused “${pipeline.name}”: no new runs`}
                  undo={{ action: resumePipelineAction, fields: { pipelineId: pipeline.id }, done: `“${pipeline.name}” is running again.`, analytics: { event: "pipeline_resume" } }}
                  analytics={{ event: "pipeline_pause" }}
                  closeOnSuccess
                  size="menu"
                  variant="ghost"
                >
                  <Pause aria-hidden />
                  Pause
                </ActionButton>
              ) : (
                <ActionButton
                  action={resumePipelineAction}
                  workspace={slug}
                  fields={{ pipelineId: pipeline.id }}
                  notice={`Resumed “${pipeline.name}”`}
                  undo={{ action: pausePipelineAction, fields: { pipelineId: pipeline.id }, done: `“${pipeline.name}” is paused again.`, analytics: { event: "pipeline_pause" } }}
                  analytics={{ event: "pipeline_resume" }}
                  closeOnSuccess
                  size="menu"
                  variant="ghost"
                >
                  <Play aria-hidden />
                  Resume
                </ActionButton>
              )}
              <ActionButton
                action={archivePipelineAction}
                workspace={slug}
                fields={{ pipelineId: pipeline.id }}
                confirm={`Archive “${pipeline.name}”? It starts no more runs, and cannot be brought back. Runs under way go on.`}
                notice={`Archived “${pipeline.name}”`}
                analytics={{ event: "pipeline_archive" }}
                closeOnSuccess
                size="menu"
                variant="ghost"
              >
                <Archive aria-hidden />
                Archive
              </ActionButton>
            </Popover>
          )}
        </div>
      </div>

      <PipelineTabs slug={slug} pipelineId={pipeline.id} tab={tab} proposals={proposals.length} />

      {tab === "map" && (
        <Card>
          <CardHeader
            title="Line"
            description={
              latestOnCurrent
                ? `The latest run, #${latest.run.number}, rides the map: each stop shows where it stands in that run.`
                : "Stops left to right; branches stack below and rejoin where they meet. Hover a stop for its instructions and rules."
            }
            action={
              latest && (
                <Link href={routes.pipelineRun(slug, latest.run.id)} className="text-xs font-semibold text-ink-2 link">
                  Run #{latest.run.number}: {latest.headline}
                </Link>
              )
            }
          />
          <CardBody className="space-y-4">
            <LineMap
              definition={latestOnCurrent ? latest.definition : definition}
              label={`${pipeline.name}'s line${latestOnCurrent ? `, with run ${latest.run.number}` : ""}`}
              servedBy={servedBy}
              states={latestOnCurrent ? Object.fromEntries(latest.stops.map((stop) => [stop.stopId, { state: stopViewState(stop.state, stop.task?.status), raw: stop.state, branch: stop.branch }])) : undefined}
              reachedEnd={latestOnCurrent ? latest.run.endId : null}
              hrefOf={latestOnCurrent ? Object.fromEntries(latest.stops.flatMap((stop) => (stop.task ? [[stop.stopId, routes.task(slug, stop.task.id)]] : []))) : undefined}
            />
            {latestOnCurrent && <StopLegend />}
          </CardBody>
        </Card>
      )}

      {tab === "runs" &&
        (history.length === 0 ? (
          <Card>
            <EmptyState icon={<Workflow />} title="No runs yet">
              Start one here, or let an agent start one with start_run{triggers.schedule ? "; the schedule starts the next one on time" : ""}.
            </EmptyState>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Runs × stops" description="One row per stop and one column per run, newest at the left. A stop that keeps failing or waiting stands out across its row." />
              <CardBody className="space-y-4">
                <RunGrid grid={runGrid(definition, history, now)} slug={slug} />
                <StopLegend />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="All runs" description="Newest first." />
              <RunList runs={history} definition={definition} slug={slug} />
            </Card>
          </div>
        ))}

      {tab === "insights" && (
        <InsightsTab slug={slug} insights={pipelineInsights(definition, history, now)} proposals={proposals} bases={proposalBases} canDecide={canChange} />
      )}

      {tab === "definition" && (
        <div className="space-y-6">
          {proposals.length > 0 && (
            <Card tone="wait">
              <CardHeader tone="wait" title={`${pluralize(proposals.length, "proposed change")} from agents`} description="An agent's change to a regular pipeline waits here until its owner or an admin approves it." />
              <CardBody className="py-1">
                <ul className="divide-y divide-rule">
                  {proposals.map((proposal, index) => (
                    <Proposal key={proposal.number} slug={slug} proposal={proposal} base={proposalBases[index] ?? null} canDecide={canChange} />
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          {canChange ? (
            <PipelineEditor
              key={pipeline.currentVersion}
              slug={slug}
              pipelineId={pipeline.id}
              pipelineName={pipeline.name}
              initial={definition}
              version={pipeline.currentVersion}
              agents={agents.filter((agent) => agent.live && !agent.archivedAt).map((agent) => agent.name)}
              people={members.map((person) => ({ id: person.userId, email: person.email, name: person.name }))}
            />
          ) : (
            <Card>
              <CardHeader title="Definition" description={pipeline.status === "archived" ? "Archived pipelines are kept as they were." : "Only its owner and the workspace's owners and admins change a regular pipeline; agents propose changes."} />
              <CardBody>
                <LineMap definition={definition} label={`${pipeline.name}'s line`} servedBy={servedBy} />
              </CardBody>
            </Card>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            {pipeline.kind === "regular" && (
              <Card>
                <CardHeader title="Triggers" description="What starts runs besides people and agents. A schedule fires at most hourly." />
                <CardBody>
                  {canChange ? (
                    <TriggersForm slug={slug} pipelineId={pipeline.id} triggers={triggers} origin={new URL(await absoluteUrl("/")).origin} />
                  ) : (
                    <ul className="space-y-1 text-sm text-ink-2">
                      <li>{triggers.schedule ? `On a schedule: ${triggers.schedule.cron} (${triggers.schedule.timeZone})` : "No schedule."}</li>
                      {triggers.events.map((event, index) => (
                        <li key={index}>When a task is captured{event.tag ? ` tagged “${event.tag}”` : ""}{event.source ? ` from ${event.source}` : ""}.</li>
                      ))}
                      <li>{triggers.webhook ? "Accepts runs by webhook." : "No webhook."}</li>
                    </ul>
                  )}
                </CardBody>
              </Card>
            )}
            <Card id="versions">
              <CardHeader title="Versions" description="Newest first. Runs keep the version they started on." />
              <CardBody className="py-1">
                <ul className="divide-y divide-rule">
                  {versions.map((version) => (
                    <li key={version.number} data-version={version.number} className="space-y-1 py-3">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold text-ink">Version {version.number}</span>
                        {version.number === pipeline.currentVersion && <span className="text-xs font-semibold text-arrive-ink">Current</span>}
                        {version.proposalState && <MetaBadge meta={PROPOSAL_STATE_META} value={version.proposalState} />}
                        <span className="text-xs text-muted">
                          {version.createdByName}, {timeAgo(version.createdAt)}
                        </span>
                        <Link href={`${routes.pipeline(slug, pipeline.id, { tab: "definition", version: String(version.number) })}#versions`} className="text-xs font-semibold text-ink-2 link">
                          Show changes
                        </Link>
                      </p>
                      {version.reason && <p className="text-xs text-ink-2">{version.reason}</p>}
                      {version.decisionNote && <p className="text-xs text-muted">Rejected: {version.decisionNote}</p>}
                      {shown?.number === version.number && <VersionChanges before={shownBase} after={shown.definition} />}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function InsightsTab({ slug, insights, proposals, bases, canDecide }: { slug: string; insights: ReturnType<typeof pipelineInsights>; proposals: PipelineVersion[]; bases: (PipelineDefinition | null)[]; canDecide: boolean }) {
  return (
    <div className="space-y-6">
      <InsightStats insights={insights} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Time per stop" description="Typical (P50) and slow (P90) time from reaching a stop to its settling, over finished stops." />
          <CardBody>
            <StopTimesTable insights={insights} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Trip time, run by run" description="Each finished run's trip time, oldest first." />
          <CardBody>
            <TripTrend insights={insights} slug={slug} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Where people wait" description="Person stops, longest typical wait first, counting decisions still open." />
          <CardBody>
            <PeopleWaits insights={insights} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Flaky stops" description="Stops that failed and then passed on a retry or a rerun in the same run." />
          <CardBody>
            <FlakyStops insights={insights} />
          </CardBody>
        </Card>
      </div>
      <Card tone={proposals.length ? "wait" : "plain"}>
        <CardHeader tone={proposals.length ? "wait" : "plain"} title="Proposed improvements" description="Agents propose new versions with their reasons; approving one makes it current." />
        <CardBody className="py-1">
          {proposals.length === 0 ? (
            <EmptyState icon={<MapIcon />} title="No proposals">
              An agent that sees a better line proposes it with update_pipeline; it waits here for you.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-rule">
              {proposals.map((proposal, index) => (
                <Proposal key={proposal.number} slug={slug} proposal={proposal} base={bases[index] ?? null} canDecide={canDecide} />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
