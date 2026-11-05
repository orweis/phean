import { Bot, CornerDownRight, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { deleteWebhookAction, revokeAgentAction } from "@/app/w/[slug]/actions";
import { ConnectAgentForm, SignInSetup } from "@/components/connect-agent-form";
import { ConnectAgentSection } from "@/components/connect-agent-section";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { ActorAvatar } from "@/components/ui/avatar";
import { Badge, MetaBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { ScrollX } from "@/components/ui/scroll-x";
import { EmptyState } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { cx } from "@/lib/cx";
import {
  ACCESS_LEVEL_META,
  AGENT_CONNECTION_META,
  AGENT_STATUS_META,
  agentConnection,
  agentStatus,
  WEBHOOK_STATE_META,
  webhookState,
  type AgentStatus,
} from "@/lib/domain";
import { formatDay, pluralize, timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { mcpResourceUrl } from "@/server/config";
import { listAgents, type ListedAgent } from "@/server/domain/agents";
import { getAgentWorkload } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { listWebhooks, type Webhook } from "@/server/domain/webhooks";
import { absoluteUrl } from "@/server/web";

export const metadata: Metadata = { title: "Agents" };

const TD = "px-3 py-3 text-xs whitespace-nowrap text-muted";

/** What a connected agent gets. */
function WhatAgentsGet() {
  return (
    <div>
      <p className="text-xs font-semibold text-ink-2">What agents get</p>
      <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-xs text-ink-2 marker:text-faint">
        <li>An operating guide and prompts for syncing, scanning sources, and triage.</li>
        <li>Tools to capture, claim, and complete tasks, and to propose and plan goals.</li>
        <li>Shared memory, so one agent&apos;s findings are every agent&apos;s context.</li>
        <li>Mermaid views of the goal tree, board, and timeline.</li>
        <li>A webhook each, so a bot hears about your decisions and changes to the work it follows as they happen.</li>
      </ul>
      <p className="mt-3 text-xs text-muted">
        Read agents only look. Write agents also do the work. Admin agents also manage other agents. Only people approve, complete, or abandon goals.
      </p>
    </div>
  );
}

export default async function AgentsPage({ params }: PageProps<"/w/[slug]/agents">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const [agents, workload, keyUrl, hooks] = await Promise.all([
    listAgents(ctx, {}),
    getAgentWorkload(ctx, {}),
    // A fixed key has no audience: the database checks it on whatever host this deployment answers, so the
    // one the person is using works. OAuth tokens are bound to the configured address, so sign-in uses that.
    absoluteUrl(routes.mcp(slug)),
    listWebhooks(ctx, {}),
  ]);
  const signInUrl = mcpResourceUrl(slug);
  const loadById = new Map(workload.map((load) => [load.agent.id, load]));
  const hookByAgent = new Map(hooks.map((hook) => [hook.agentId, hook]));
  const canManage = can(ctx.actor, "agent:manage");
  const canConnect = can(ctx.actor, "agent:connect");
  const canIssueKey = can(ctx.actor, "agent:issue_key");
  const canRemoveWebhooks = can(ctx.actor, "webhook:manage");
  const viewerId = ctx.actor.type === "user" ? ctx.actor.id : null;
  // Sub-agents sit right under the agent they work for.
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const children = new Map<string, ListedAgent[]>();
  for (const agent of agents) if (agent.parentAgentId) children.set(agent.parentAgentId, [...(children.get(agent.parentAgentId) ?? []), agent]);
  const ordered = agents.filter((agent) => !agent.parentAgentId).flatMap((agent) => [agent, ...(children.get(agent.id) ?? [])]);
  const parents = agents.filter((agent) => !agent.parentAgentId && !agent.revokedAt).map(({ id, name }) => ({ id, name }));

  // The server's standing: a sub-agent lapses with its parent and never has more access than it, and an
  // approver who left or was demoted shows here exactly as every request is told.
  const rows = ordered.map((agent) => {
    const parent = agent.parentAgentId ? byId.get(agent.parentAgentId) : undefined;
    const endsAt = agent.accessEndsAt;
    const status = agentStatus({ ...agent, accessExpiresAt: endsAt });
    return {
      agent,
      parent,
      endsAt,
      endsWithParent: !!parent && endsAt !== null && endsAt.getTime() === parent.accessExpiresAt?.getTime() && endsAt.getTime() !== agent.accessExpiresAt?.getTime(),
      level: agent.level,
      status,
      // People revoke agents they approved; revoking a parent takes its sub-agents with it.
      revocable: status !== "revoked" && (canManage || (viewerId !== null && agent.createdByUserId === viewerId)),
    };
  });
  const hasActions = rows.some((row) => row.revocable || (canRemoveWebhooks && hookByAgent.has(row.agent.id)));

  return (
    <>
      <PageHeader
        title="Agents"
        description="Every agent connected to this workspace shares its goals, tasks, and memory. Each is approved on its own, so its work is attributed and it can be cut off on its own. Agents can run sub-agents of their own, listed under them."
      />

      {/* The connect card leads only until the first agent is connected; then it folds to a bar and the agents lead. */}
      <ConnectAgentSection
        collapsed={agents.length > 0}
        title={canConnect ? "Connect an agent" : "How agents connect"}
        description={
          canConnect
            ? "Add Phean to your MCP client with just the URL. When the agent first connects, you approve it in your browser."
            : "A workspace member approves each agent in their browser when it first connects."
        }
        action={
          canIssueKey && (
            <Popover
              variant="ghost"
              icon={<KeyRound aria-hidden />}
              label={<span className="max-sm:sr-only">Key for a bot</span>}
              triggerClassName="max-sm:px-2"
              title="Fixed key for an unattended bot"
              className="sm:w-xl"
            >
              <ConnectAgentForm slug={slug} mcpUrl={keyUrl} parents={parents} />
            </Popover>
          )
        }
      >
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <SignInSetup slug={slug} mcpUrl={signInUrl} />
          </div>
          <div className="min-w-0 lg:border-l lg:border-rule lg:pl-6">
            <WhatAgentsGet />
          </div>
        </div>
      </ConnectAgentSection>

      <Card className="min-w-0">
        <CardHeader title="Connected agents" description="Holding counts open tasks an agent has claimed; done counts the last 7 days." />
        {agents.length === 0 ? (
          <EmptyState icon={<Bot />} title="No agents yet">
            Add Phean to your MCP client to connect your first agent.
          </EmptyState>
        ) : (
          <ScrollX>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule">
                  <th className={cx(TH, "pl-5 text-left", PINNED_CELL)}>Agent</th>
                  <th className={cx(TH, "text-left")}>Status</th>
                  <th className={cx(TH, "text-left")}>Access</th>
                  <th className={cx(TH, "text-left")}>Ends</th>
                  <th className={cx(TH, "text-right")}>Holding</th>
                  <th className={cx(TH, "text-right")}>Done</th>
                  <th className={cx(TH, "text-left")}>Webhook</th>
                  <th className={cx(TH, "text-left")}>Seen</th>
                  {hasActions && (
                    <th className="px-5 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map(({ agent, parent, endsAt, endsWithParent, level, status, revocable }) => {
                  const load = loadById.get(agent.id);
                  const holding = load?.claimed ?? 0;
                  const running = (children.get(agent.id) ?? []).filter((child) => !child.revokedAt).length;
                  const removableHook = canRemoveWebhooks && hookByAgent.has(agent.id);
                  return (
                    <tr key={agent.id} data-agent={agent.id} data-parent={agent.parentAgentId ?? undefined} className={cx(status === "revoked" && "text-muted", parent && "bg-fill/40")}>
                      <td className={cx("min-w-44 py-3 pr-3", parent ? "pl-10" : "pl-5", PINNED_CELL)}>
                        <div className="flex items-center gap-2.5">
                          {parent && <CornerDownRight className="size-3.5 shrink-0 text-faint" aria-hidden />}
                          <ActorAvatar type="agent" className="mt-0" />
                          <div className="min-w-0">
                            <p className={cx("font-semibold whitespace-nowrap", status !== "revoked" && "text-ink")}>
                              {agent.name}
                              {parent && <span className="sr-only">, sub-agent of {parent.name}</span>}
                            </p>
                            {agent.purpose && (
                              <p className="max-w-64 truncate text-xs text-ink-2" title={agent.purpose}>
                                {agent.purpose}
                              </p>
                            )}
                            {running > 0 && <p className="text-xs text-muted">Runs {pluralize(running, "sub-agent")}</p>}
                            {agent.sharesParentKey ? (
                              // Detected: it connects with its agent's credential and names itself, so it has none of its own.
                              <p className="text-xs whitespace-nowrap text-muted">Detected · shares {parent?.name}&apos;s key</p>
                            ) : (
                              agent.tokenPrefix && (
                                <p className="font-mono text-xs whitespace-nowrap text-muted" title={`Key starting ${agent.tokenPrefix}`}>
                                  {agent.tokenPrefix}…
                                </p>
                              )
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <StatusCell slug={slug} agentId={agent.id} status={status} holding={holding} />
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        <MetaBadge meta={ACCESS_LEVEL_META} value={level} />
                        <span className="mt-1 block text-muted">{AGENT_CONNECTION_META[agentConnection(agent)].label}</span>
                      </td>
                      <td className={TD}>
                        <AccessEnds endsAt={endsAt} revokedAt={agent.revokedAt} status={status} />
                        {endsWithParent && parent && <span className="block">with {parent.name}</span>}
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
                      {hasActions && (
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            {removableHook && (
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
                            {revocable && (
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

function StatusCell({ slug, agentId, status, holding }: { slug: string; agentId: string; status: AgentStatus; holding: number }) {
  if (status !== "idle" || holding === 0) return <MetaBadge meta={AGENT_STATUS_META} value={status} />;
  // An idle agent sitting on work is the case a person needs to notice: show it, and lead to that work.
  return (
    <Link href={routes.board(slug, { agent: agentId })} className="rounded-full">
      <Badge tone="warning">Idle · holding {holding}</Badge>
      <span className="sr-only">: see the {pluralize(holding, "task")} it holds</span>
    </Link>
  );
}

/** When access ends: a fixed key has no end; an approval lasts until its date unless renewed. */
function AccessEnds({ endsAt, revokedAt, status }: { endsAt: Date | null; revokedAt: Date | null; status: AgentStatus }) {
  if (revokedAt) return <>Revoked {formatDay(revokedAt)}</>;
  if (!endsAt) return <>No end date</>;
  if (status === "expired") return <>Ended {formatDay(endsAt)}</>;
  return (
    <>
      Ends {formatDay(endsAt)}
      <span className="block">{timeAgo(endsAt)}</span>
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
