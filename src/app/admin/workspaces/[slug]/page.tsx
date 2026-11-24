import { ExternalLink, Eye, EyeOff } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { revealContentAction } from "@/app/admin/actions";
import { Fact, Figure, TableScroll, TwoFactorGate } from "@/components/backoffice/parts";
import { FlowBar, FlowLegend } from "@/components/charts/flow-bar";
import { WeekBars } from "@/components/charts/week-bars";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, MetaBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { CONTENT_GRANT_MINUTES, CONTENT_REASON_MAX, CONTENT_REASON_MIN, formatBytes, REPORT_DAYS } from "@/lib/backoffice";
import { cx } from "@/lib/cx";
import { formatDueDate, formatDuration, pluralize, timeAgo } from "@/lib/format";
import { isOneOf, ROLE_META, STATIONS, TASK_STATUS_META, type MemberRole } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { getWorkspaceContent, getWorkspaceDetail, type WorkspaceContent } from "@/server/backoffice";
import { isDomainError } from "@/server/domain/errors";
import { requireBackoffice } from "@/server/backoffice/session";

export const metadata: Metadata = { title: "Workspace" };

const day = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const time = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

const ago = (ms: number | null) => timeAgo(ms === null ? null : new Date(ms));

function Table({ caption, head, children }: { caption: string; head: string[]; children: ReactNode }) {
  return (
    <TableScroll label={caption}>
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-rule">
            {head.map((label, index) => (
              <th key={label} scope="col" className={cx(TH, index === 0 ? cx("pl-5 text-left", PINNED_CELL) : "text-left", index === head.length - 1 && "pr-5")}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">{children}</tbody>
      </table>
    </TableScroll>
  );
}

const FIRST = cx("max-w-60 py-2.5 pr-3 pl-5", PINNED_CELL);
const CELL = "px-3 py-2.5 whitespace-nowrap";

/** Counts by state, as "12 delivered · 1 dead", or "None". */
function counted(record: Record<string, number>): string {
  const parts = Object.entries(record).map(([state, count]) => `${count} ${state}`);
  return parts.length ? parts.join(" · ") : "None";
}

export default async function AdminWorkspacePage({ params }: PageProps<"/admin/workspaces/[slug]">) {
  const access = await requireBackoffice();
  if (access.refusal) return <TwoFactorGate />;
  const { slug } = await params;
  const detail = await getWorkspaceDetail(access.ctx, { slug }).catch((error: unknown) => {
    if (isDomainError(error) && error.code === "not_found") notFound();
    throw error;
  });
  const content = detail.grant ? await getWorkspaceContent(access.ctx, { slug }) : null;
  const { tenant, members, agents, decisions, activity } = detail;
  const live = agents.filter((agent) => agent.state === "live");
  const openTasks = (["inbox", "backlog", "todo", "in_progress"] as const).reduce((sum, status) => sum + (detail.tasksByStatus[status] ?? 0), 0);
  const days = activity.days.map((date) => ({ from: date, to: date }));

  return (
    <>
      <PageHeader
        title={tenant.name}
        description={`/w/${tenant.slug}, created ${day.format(tenant.createdAt)}. Metadata only: names, counts and times. Customer content stays hidden until you show it, below, with a reason.`}
        actions={
          // The workspace's own pages open for a platform admin only within a content grant.
          detail.grant && (
            <ButtonLink href={routes.workspace(tenant.slug)} variant="secondary">
              <ExternalLink aria-hidden />
              Open read-only
            </ButtonLink>
          )
        }
      />

      <Card className="mb-6">
        <dl className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Members">{members.length}</Fact>
          <Fact label="Live agents">{live.length}</Fact>
          <Fact label="Open tasks">{openTasks}</Fact>
          <Fact label="Open decisions">{decisions.open}</Fact>
          <Fact label="Goals · memories">
            {detail.goals} · {detail.memories}
          </Fact>
          <Fact label="Documents">{`${detail.storage.documents} · ${formatBytes(detail.storage.bytes)}`}</Fact>
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title={`Activity, last ${REPORT_DAYS} days`} description="Events per day from the usage rollup (today live), and by action. Event summaries are content and are not shown." />
          <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <WeekBars label="Events" unit="Day" windows={days} values={activity.perDay} labelOf={(window) => formatDueDate(window.from)} />
            {activity.byAction.length === 0 ? (
              <p className="text-sm text-muted">Nothing happened in these {REPORT_DAYS} days.</p>
            ) : (
              <ul tabIndex={0} className="max-h-48 space-y-1 overflow-y-auto rounded-xs text-xs focus-visible:outline-2 focus-visible:outline-focus" aria-label="Events by action">
                {activity.byAction.map((row) => (
                  <li key={row.action} className="flex justify-between gap-3">
                    <span className="truncate font-mono text-ink-2">{row.action}</span>
                    <span className="figure shrink-0 font-semibold text-ink">{row.events}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tasks" description="Every task in the workspace by status, archived ones included." />
          <CardBody className="space-y-3">
            <FlowBar counts={detail.tasksByStatus} stations={STATIONS} size="md" label="Tasks by status" />
            <FlowLegend counts={detail.tasksByStatus} stations={STATIONS} />
            {(detail.tasksByStatus.dropped ?? 0) > 0 && <p className="text-xs text-muted">{detail.tasksByStatus.dropped} dropped</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Decisions" description={`Requests agents asked and people answered in the last ${REPORT_DAYS} days, and what is open now.`} />
          <dl className="grid grid-cols-2 gap-4 px-5 py-4">
            <Fact label="Asked">{decisions.asked}</Fact>
            <Fact label="Answered">{decisions.answered}</Fact>
            <Fact label="Median time to answer">{decisions.medianAnswerMs === null ? "None" : formatDuration(decisions.medianAnswerMs)}</Fact>
            <Fact label="Open now">
              {decisions.open}
              {decisions.oldestOpenAt !== null && <span className="block text-xs font-normal text-muted">oldest {ago(decisions.oldestOpenAt)}</span>}
            </Fact>
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Members" description="People in the workspace, their role, and whether their account has two-factor." />
          <Table caption="Members" head={["Person", "Role", "Joined", "Two-factor"]}>
            {members.map((person) => (
              <tr key={person.email}>
                <td className={FIRST}>
                  <p className="truncate font-semibold text-ink">{person.name}</p>
                  <p className="truncate text-xs text-ink-2">{person.email}</p>
                </td>
                <td className={CELL}>{isOneOf(["owner", "admin", "member"] as const, person.role) ? <MetaBadge meta={ROLE_META} value={person.role as MemberRole} /> : person.role}</td>
                <td className={cx(CELL, "text-xs text-ink-2")}>{day.format(person.joinedAt)}</td>
                <td className={cx(CELL, "pr-5 text-xs")}>{person.twoFactor ? <Badge tone="success">On</Badge> : <span className="text-muted">Off</span>}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Agents" description={`Every agent but the pipelines agent: its client, level, when it was last seen, and its MCP calls and errors in the last ${REPORT_DAYS} days. Sub-agents sit under their parent.`} />
          {agents.length === 0 ? (
            <EmptyState title="No agents connected" />
          ) : (
            <Table caption="Agents" head={["Agent", "Client", "Level", "Approved by", "Last seen", "Calls", "State"]}>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td className={FIRST}>
                    <p className={cx("truncate font-semibold text-ink", agent.parentAgentId && "pl-4")}>
                      {agent.parentAgentId && <span className="sr-only">Sub-agent: </span>}
                      {agent.name}
                    </p>
                  </td>
                  <td className={cx(CELL, "text-xs text-ink-2")}>
                    {agent.client}
                    {agent.clientName && agent.clientName !== agent.client && <span className="block max-w-40 truncate text-muted">{agent.clientName}</span>}
                  </td>
                  <td className={cx(CELL, "text-xs capitalize")}>{agent.level}</td>
                  <td className={cx(CELL, "text-xs text-ink-2")}>{agent.approvedBy ?? "No one"}</td>
                  <td className={cx(CELL, "text-xs text-ink-2")}>{ago(agent.lastSeenAt)}</td>
                  <td className={cx(CELL, "text-right")}>
                    <Figure value={agent.calls} />
                    {agent.errors > 0 && <p className="text-xs text-late-ink">{pluralize(agent.errors, "error")}</p>}
                  </td>
                  <td className={cx(CELL, "pr-5")}>
                    <Badge tone={agent.state === "live" ? "success" : "neutral"}>{agent.state === "live" ? "Live" : agent.state === "revoked" ? "Revoked" : "Lapsed"}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Pipelines" description="Each pipeline with its runs by outcome." />
          {detail.pipelines.length === 0 ? (
            <EmptyState title="No pipelines" />
          ) : (
            <Table caption="Pipelines" head={["Pipeline", "Runs", "Last run"]}>
              {detail.pipelines.map((pipeline) => (
                <tr key={pipeline.id}>
                  <td className={FIRST}>
                    <p className="truncate font-semibold text-ink">{pipeline.name}</p>
                    <p className="text-xs text-muted">
                      {pipeline.kind}, {pipeline.status}
                    </p>
                  </td>
                  <td className={cx(CELL, "text-xs text-ink-2")}>{counted(pipeline.runs)}</td>
                  <td className={cx(CELL, "pr-5 text-xs text-ink-2")}>{ago(pipeline.lastRunAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Webhooks" description={`Each agent's endpoint (its host only), its state, and deliveries in the last ${REPORT_DAYS} days. Secrets and headers are never shown.`} />
          {detail.webhooks.length === 0 ? (
            <EmptyState title="No webhooks" />
          ) : (
            <Table caption="Webhooks" head={["Agent", "Host", "State", "Deliveries"]}>
              {detail.webhooks.map((webhook) => (
                <tr key={`${webhook.agentName}-${webhook.host}`}>
                  <td className={FIRST}>
                    <p className="truncate font-semibold text-ink">{webhook.agentName}</p>
                    <p className="text-xs text-muted">{webhook.topics.join(", ")}</p>
                  </td>
                  <td className={cx(CELL, "font-mono text-xs text-ink-2")}>{webhook.host}</td>
                  <td className={CELL}>
                    <Badge tone={webhook.status === "disabled" ? "danger" : webhook.failures > 0 ? "warning" : "success"}>
                      {webhook.status === "disabled" ? "Disabled" : webhook.failures > 0 ? `${webhook.failures} failing` : "Healthy"}
                    </Badge>
                  </td>
                  <td className={cx(CELL, "pr-5 text-xs text-ink-2")}>{counted(webhook.deliveries)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Notifications" description={`Members' push devices (a device hears every workspace its person belongs to), people who muted this workspace, and pushes in the last ${REPORT_DAYS} days. Endpoints are never shown.`} />
          <dl className="grid grid-cols-2 gap-4 px-5 py-4">
            <Fact label="Devices">{detail.push.devices}</Fact>
            <Fact label="People with a device">{detail.push.people}</Fact>
            <Fact label="Muted">{detail.push.mutes}</Fact>
            <Fact label="Pushes">{counted(detail.push.deliveries)}</Fact>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Storage" description="Documents' current versions by format; earlier versions are deleted as they are replaced." />
          {detail.storage.byFormat.length === 0 ? (
            <EmptyState title="No documents" />
          ) : (
            <Table caption="Storage by format" head={["Format", "Documents", "Size"]}>
              {detail.storage.byFormat.map((row) => (
                <tr key={row.format}>
                  <td className={cx(FIRST, "font-mono text-xs")}>{row.format}</td>
                  <td className={cx(CELL, "text-right")}>{row.documents}</td>
                  <td className={cx(CELL, "pr-5 text-right text-xs text-ink-2")}>{formatBytes(row.bytes)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <ContentCard slug={tenant.slug} content={content} />
      </div>
    </>
  );
}

/** Customer content, behind a reason: the form until there is a grant, then the recent titles and decisions. */
function ContentCard({ slug, content }: { slug: string; content: WorkspaceContent | null }) {
  if (!content) {
    return (
      <Card id="content" className="lg:col-span-2">
        <CardHeader title="Content" description={`Task titles, decision text and the workspace's own pages are customer content. Showing them records your reason in the audit log, and they stay open to you for ${CONTENT_GRANT_MINUTES} minutes.`} />
        <CardBody>
          <ActionForm action={revealContentAction} className="max-w-xl space-y-3">
            <input type="hidden" name="slug" value={slug} />
            <Field label="Why do you need to see it?" htmlFor="reveal-reason" hint={`At least ${CONTENT_REASON_MIN} characters, such as a support ticket.`}>
              <Textarea id="reveal-reason" name="reason" required minLength={CONTENT_REASON_MIN} maxLength={CONTENT_REASON_MAX} rows={2} />
            </Field>
            <SubmitButton variant="secondary">
              <Eye aria-hidden />
              Show content
            </SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    );
  }
  return (
    <Card id="content" className="lg:col-span-2" tone="wait">
      <CardHeader
        tone="wait"
        title="Content"
        description={`Shown to you until ${time.format(content.until)}, because: “${content.reason}”. Every look is in the audit log.`}
        action={
          <span className="flex items-center gap-1 text-xs text-wait-ink">
            <EyeOff className="size-3.5" aria-hidden />
            Hides at {time.format(content.until)}
          </span>
        }
      />
      <div className="grid gap-px bg-rule lg:grid-cols-3">
        <section className="bg-panel px-5 py-4" aria-labelledby="content-tasks">
          <h3 id="content-tasks" className="mb-2 text-sm font-semibold text-ink">
            Recent tasks
          </h3>
          {content.tasks.length === 0 ? (
            <p className="text-sm text-muted">No tasks.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {content.tasks.map((task, index) => (
                <li key={index} className="flex items-start justify-between gap-2">
                  <span className="wrap-anywhere text-ink">{task.title}</span>
                  <span className="shrink-0 text-xs text-muted">{TASK_STATUS_META[task.status].label}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="bg-panel px-5 py-4" aria-labelledby="content-open">
          <h3 id="content-open" className="mb-2 text-sm font-semibold text-ink">
            Open requests
          </h3>
          {content.open.length === 0 ? (
            <p className="text-sm text-muted">None open.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {content.open.map((request, index) => (
                <li key={index}>
                  <p className="wrap-anywhere text-ink">{request.question}</p>
                  <p className="text-xs text-muted">
                    {request.agentName} asked {timeAgo(request.askedAt)}
                    {request.options > 0 && `, ${request.options} options`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="bg-panel px-5 py-4" aria-labelledby="content-answered">
          <h3 id="content-answered" className="mb-2 text-sm font-semibold text-ink">
            Recent answers
          </h3>
          {content.answered.length === 0 ? (
            <p className="text-sm text-muted">Nothing answered yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {content.answered.map((answer, index) => (
                <li key={index}>
                  <p className="wrap-anywhere text-ink">{answer.question}</p>
                  <p className="wrap-anywhere text-xs text-ink-2">
                    {answer.answer ? `“${answer.answer}”` : answer.outcome.replace("_", " ")}, {timeAgo(answer.closedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}
