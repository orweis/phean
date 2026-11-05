import { Archive, ArchiveRestore, Bot, CornerDownRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { archiveAgentAction, archiveRevokedAgentsAction, deleteWebhookAction, revokeAgentAction, unarchiveAgentAction } from "@/app/w/[slug]/actions";
import { AGENT_STATUS_META, agentStatus } from "@/components/agent-list";
import { ConnectAgentForm } from "@/components/connect-agent-form";
import { ConnectAgentSection } from "@/components/connect-agent-section";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { ActorAvatar } from "@/components/ui/avatar";
import { Badge, MetaBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { CopyField } from "@/components/ui/copy-button";
import { ScrollX } from "@/components/ui/scroll-x";
import { EmptyState } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { cx } from "@/lib/cx";
import { WEBHOOK_STATE_META, webhookState } from "@/lib/domain";
import { pluralize, timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listAgents } from "@/server/domain/agents";
import { getAgentWorkload } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { listWebhooks, type Webhook } from "@/server/domain/webhooks";
import { absoluteUrl } from "@/server/web";

export const metadata: Metadata = { title: "Agents" };

const TD = "px-3 py-3 text-xs whitespace-nowrap text-muted";

/** What an agent with a token gets, beside the endpoint it connects to. */
function WhatAgentsGet({ mcpUrl }: { mcpUrl: string }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-ink-2">MCP endpoint</p>
        <p className="mt-0.5 mb-2 text-xs text-muted">Streamable HTTP, authenticated with a bearer token.</p>
        <CopyField value={mcpUrl} surface="fill" />
      </div>
      <div>
        <p className="text-xs font-semibold text-ink-2">What agents get</p>
        <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-xs text-ink-2 marker:text-faint">
          <li>An operating guide and prompts for syncing, scanning sources, and triage.</li>
          <li>Tools to capture, claim, and complete tasks, and to propose and plan goals.</li>
          <li>Shared memory, so one agent&apos;s findings are every agent&apos;s context.</li>
          <li>Mermaid views of the goal tree, board, and timeline.</li>
          <li>A webhook each, so a bot hears about your decisions and changes to the work it follows as they happen.</li>
        </ul>
        <p className="mt-3 text-xs text-muted">Agents can propose goals but only people can approve, complete, or abandon them.</p>
      </div>
    </div>
  );
}

export default async function AgentsPage({ params, searchParams }: PageProps<"/w/[slug]/agents">) {
  const showArchived = (await searchParams).archived === "1";
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const [agents, workload, mcpUrl, hooks] = await Promise.all([
    listAgents(ctx, {}),
    getAgentWorkload(ctx, {}),
    absoluteUrl(routes.mcp()),
    listWebhooks(ctx, {}),
  ]);
  const loadById = new Map(workload.map((load) => [load.agent.id, load]));
  const hookByAgent = new Map(hooks.map((hook) => [hook.agentId, hook]));
  const canManage = can(ctx.actor, "agent:manage");
  // Sub-agents sit right under the agent they work for.
  // Archived (revoked, filed away) agents have their own view; the list shows the rest.
  const listed = agents.filter((agent) => Boolean(agent.archivedAt) === showArchived);
  const listedIds = new Set(listed.map((agent) => agent.id));
  const archivedCount = agents.length - agents.filter((agent) => !agent.archivedAt).length;
  const revokedListed = listed.filter((agent) => agent.revokedAt).length;
  const children = new Map<string, typeof agents>();
  for (const agent of listed) if (agent.parentAgentId) children.set(agent.parentAgentId, [...(children.get(agent.parentAgentId) ?? []), agent]);
  // A sub-agent whose parent is not in this view stands on its own row.
  const ordered = listed
    .filter((agent) => !agent.parentAgentId || !listedIds.has(agent.parentAgentId))
    .flatMap((agent) => [agent, ...(agent.parentAgentId ? [] : (children.get(agent.id) ?? []))]);
  const parents = agents.filter((agent) => !agent.parentAgentId && !agent.revokedAt).map(({ id, name }) => ({ id, name }));
  const nameOf = new Map(agents.map((agent) => [agent.id, agent.name]));

  return (
    <>
      <PageHeader
        title="Agents"
        description="Every agent connected to this workspace shares its goals, tasks, and memory. Each has its own token, so its work is attributed and it can be cut off on its own. Agents can run sub-agents of their own, listed under them."
      />

      {/* The connect form leads only until the first agent is connected; then it folds to a bar and the agents lead. */}
      <ConnectAgentSection
        collapsed={agents.length > 0}
        title={canManage ? "Connect an agent" : "How agents connect"}
        description={canManage ? "Issue a token, then paste the snippet into your MCP client." : "A workspace admin issues each agent its token."}
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {canManage && (
            <div className="min-w-0 lg:col-span-2">
              <ConnectAgentForm slug={slug} mcpUrl={mcpUrl} parents={parents} />
            </div>
          )}
          <div className={cx("min-w-0", canManage ? "lg:border-l lg:border-rule lg:pl-6" : "lg:col-span-3")}>
            <WhatAgentsGet mcpUrl={mcpUrl} />
          </div>
        </div>
      </ConnectAgentSection>

      <Card className="min-w-0">
        <CardHeader
          title={showArchived ? "Archived agents" : "Connected agents"}
          description={
            showArchived
              ? "Revoked agents filed away. Their past work keeps their name; unarchive one to list it again."
              : "Holding counts open tasks an agent has claimed; done counts the last 7 days."
          }
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canManage && !showArchived && revokedListed > 0 && (
                <ActionButton
                  action={archiveRevokedAgentsAction}
                  fields={{}}
                  workspace={slug}
                  confirm={`Archive ${pluralize(revokedListed, "revoked agent")}? They leave this list; the Archived view keeps them.`}
                  closeOnSuccess
                  size="sm"
                  variant="ghost"
                >
                  <Archive aria-hidden />
                  Archive revoked
                </ActionButton>
              )}
              {showArchived ? (
                <Link href={routes.agents(slug)} className="text-xs font-semibold text-accent-ink link whitespace-nowrap">
                  Back to agents
                </Link>
              ) : (
                archivedCount > 0 && (
                  <Link href={`${routes.agents(slug)}?archived=1`} className="text-xs font-semibold text-accent-ink link whitespace-nowrap">
                    Archived ({archivedCount})
                  </Link>
                )
              )}
            </div>
          }
        />
        {ordered.length === 0 && showArchived ? (
          <EmptyState icon={<Archive />} title="Nothing archived">
            Archive a revoked agent to file it away here.
          </EmptyState>
        ) : agents.length === 0 ? (
          <EmptyState icon={<Bot />} title="No agents yet">
            {canManage ? "Issue a token to connect your first agent." : "Ask a workspace admin to connect an agent."}
          </EmptyState>
        ) : (
          <ScrollX>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule">
                  <th className={cx(TH, "pl-5 text-left", PINNED_CELL)}>Agent</th>
                  <th className={cx(TH, "text-left")}>Status</th>
                  <th className={cx(TH, "text-right")}>Holding</th>
                  <th className={cx(TH, "text-right")}>Done</th>
                  <th className={cx(TH, "text-left")}>Webhook</th>
                  <th className={cx(TH, "text-left")}>Seen</th>
                  {canManage && (
                    <th className="px-5 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {ordered.map((agent) => {
                  const status = agentStatus(agent);
                  const load = loadById.get(agent.id);
                  const holding = load?.claimed ?? 0;
                  const sub = Boolean(agent.parentAgentId);
                  const running = (children.get(agent.id) ?? []).filter((child) => !child.revokedAt).length;
                  return (
                    <tr key={agent.id} data-agent={agent.id} data-parent={agent.parentAgentId ?? undefined} className={cx(status === "revoked" && "text-muted", sub && "bg-fill/40")}>
                      <td className={cx("min-w-44 py-3 pr-3", sub ? "pl-10" : "pl-5", PINNED_CELL)}>
                        <div className="flex items-center gap-2.5">
                          {sub && <CornerDownRight className="size-3.5 shrink-0 text-faint" aria-hidden />}
                          <ActorAvatar type="agent" className="mt-0" />
                          <div className="min-w-0">
                            <p className={cx("font-semibold whitespace-nowrap", status !== "revoked" && "text-ink")}>
                              {agent.name}
                              {sub && <span className="sr-only">, sub-agent of {nameOf.get(agent.parentAgentId!)}</span>}
                            </p>
                            {agent.purpose && (
                              <p className="max-w-64 truncate text-xs text-ink-2" title={agent.purpose}>
                                {agent.purpose}
                              </p>
                            )}
                            {running > 0 && <p className="text-xs text-muted">Runs {pluralize(running, "sub-agent")}</p>}
                            {agent.sharesParentKey ? (
                              // Detected: it connects with its agent's token and names itself, so it has no token of its own.
                              <p className="text-xs whitespace-nowrap text-muted">Detected · shares {nameOf.get(agent.parentAgentId!)}&apos;s key</p>
                            ) : (
                              <p className="font-mono text-xs whitespace-nowrap text-muted" title={`Token starting ${agent.tokenPrefix}`}>
                                {agent.tokenPrefix}…
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {status === "idle" && holding > 0 ? (
                          // An idle agent sitting on work is the case a person needs to notice: show it, and lead to that work.
                          <Link href={routes.board(slug, { agent: agent.id })} className="rounded-full">
                            <Badge tone="warning">Idle · holding {holding}</Badge>
                            <span className="sr-only">: see the {pluralize(holding, "task")} it holds</span>
                          </Link>
                        ) : (
                          <MetaBadge meta={AGENT_STATUS_META} value={status} />
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-ink">{holding}</td>
                      <td className="px-3 py-3 text-right font-semibold text-ink">{load?.completedLast7Days ?? 0}</td>
                      <td className="px-3 py-3 text-xs">
                        <WebhookCell hook={hookByAgent.get(agent.id)} />
                      </td>
                      <td className={TD}>
                        {agent.lastSeenAt ? `Seen ${timeAgo(agent.lastSeenAt)}` : "Never seen"}
                        <span className="block">connected {timeAgo(agent.createdAt)}</span>
                      </td>
                      {canManage && (
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            {hookByAgent.has(agent.id) && (
                              <ActionButton
                                action={deleteWebhookAction}
                                workspace={slug}
                                fields={{ agentId: agent.id }}
                                confirm={`Remove ${agent.name}'s webhook? Phean stops calling it; the agent can register a new one.`}
                                size="sm"
                                variant="ghost"
                              >
                                Remove webhook
                              </ActionButton>
                            )}
                            {status === "revoked" && !agent.archivedAt && (
                              <ActionButton
                                action={archiveAgentAction}
                                workspace={slug}
                                fields={{ agentId: agent.id }}
                                notice={`Archived ${agent.name}`}
                                undo={{ action: unarchiveAgentAction, fields: { agentId: agent.id }, done: `${agent.name} is back on the list.` }}
                                exits
                                size="sm"
                                variant="ghost"
                              >
                                <Archive aria-hidden />
                                Archive
                              </ActionButton>
                            )}
                            {agent.archivedAt && (
                              <ActionButton
                                action={unarchiveAgentAction}
                                workspace={slug}
                                fields={{ agentId: agent.id }}
                                notice={`Put ${agent.name} back on the list`}
                                exits
                                size="sm"
                                variant="ghost"
                              >
                                <ArchiveRestore aria-hidden />
                                Unarchive
                              </ActionButton>
                            )}
                            {status !== "revoked" && (
                              <ActionButton
                                action={revokeAgentAction}
                                workspace={slug}
                                fields={{ agentId: agent.id }}
                                confirm={
                                  running > 0
                                    ? `Revoke ${agent.name} and its ${pluralize(running, "sub-agent")}? They lose access immediately; their past work stays.`
                                    : `Revoke ${agent.name}? It loses access immediately; its past work stays.`
                                }
                                size="sm"
                                variant="danger"
                              >
                                Revoke
                              </ActionButton>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollX>
        )}
      </Card>
    </>
  );
}

/** Where an agent's webhook points and how it is doing; the last error shows on hover. */
function WebhookCell({ hook }: { hook: Webhook | undefined }) {
  if (!hook) return <span className="text-muted">None</span>;
  const state = webhookState(hook);
  const problem = hook.disabledReason ?? hook.lastError;
  return (
    <div className="space-y-1" title={problem ?? undefined}>
      <MetaBadge meta={WEBHOOK_STATE_META} value={state} />
      <p className="font-mono text-muted">{new URL(hook.url).host}</p>
      {state !== "active" && problem && <p className="max-w-56 truncate text-muted">{problem}</p>}
    </div>
  );
}
