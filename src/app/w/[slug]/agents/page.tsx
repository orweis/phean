import { Bot } from "lucide-react";
import type { Metadata } from "next";

import { deleteWebhookAction, revokeAgentAction } from "@/app/w/[slug]/actions";
import { AGENT_STATUS_META, agentStatus } from "@/components/agent-list";
import { ConnectAgentForm } from "@/components/connect-agent-form";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { MetaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyField } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { cx } from "@/lib/cx";
import { WEBHOOK_STATE_META, webhookState } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listAgents } from "@/server/domain/agents";
import { getAgentWorkload } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { listWebhooks, type Webhook } from "@/server/domain/webhooks";
import { absoluteUrl } from "@/server/web";

export const metadata: Metadata = { title: "Agents" };

const TD = "px-3 py-3 text-xs whitespace-nowrap text-muted";

export default async function AgentsPage({ params }: PageProps<"/w/[slug]/agents">) {
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

  return (
    <>
      <PageHeader
        title="Agents"
        description="Every agent connected to this workspace shares its goals, tasks, and memory. Each has its own token, so its work is attributed and it can be cut off on its own."
      />

      {canManage && (
        <Card className="mb-6">
          <CardHeader title="Connect an agent" description="Issue a token, then paste the snippet into your MCP client." />
          <CardBody>
            <ConnectAgentForm slug={slug} mcpUrl={mcpUrl} />
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title="Connected agents" description="Holding counts open tasks an agent has claimed; done counts the last 7 days." />
          {agents.length === 0 ? (
            <EmptyState icon={<Bot />} title="No agents yet">
              {canManage ? "Issue a token to connect your first agent." : "Ask a workspace admin to connect an agent."}
            </EmptyState>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule">
                    <th className={cx(TH, "pl-5 text-left", PINNED_CELL)}>Agent</th>
                    <th className={cx(TH, "text-left")}>Status</th>
                    <th className={cx(TH, "text-right")}>Holding</th>
                    <th className={cx(TH, "text-right")}>Done</th>
                    <th className={cx(TH, "text-left")}>Webhook</th>
                    <th className={cx(TH, "text-left")}>Last seen</th>
                    <th className={cx(TH, "text-left")}>Connected</th>
                    {canManage && (
                      <th className="px-5 py-2.5">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {agents.map((agent) => {
                    const status = agentStatus(agent);
                    const load = loadById.get(agent.id);
                    return (
                      <tr key={agent.id} className={cx(status === "revoked" && "text-muted")}>
                        <td className={cx("py-3 pr-3 pl-5", PINNED_CELL)}>
                          <p className={cx("font-semibold", status !== "revoked" && "text-ink")}>{agent.name}</p>
                          <p className="font-mono text-xs text-muted">{agent.tokenPrefix}…</p>
                        </td>
                        <td className="px-3 py-3">
                          <MetaBadge meta={AGENT_STATUS_META} value={status} />
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-ink">{load?.claimed ?? 0}</td>
                        <td className="px-3 py-3 text-right font-semibold text-ink">{load?.completedLast7Days ?? 0}</td>
                        <td className="px-3 py-3 text-xs">
                          <WebhookCell hook={hookByAgent.get(agent.id)} />
                        </td>
                        <td className={TD}>{timeAgo(agent.lastSeenAt)}</td>
                        <td className={TD}>{timeAgo(agent.createdAt)}</td>
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
                              {status !== "revoked" && (
                                <ActionButton
                                  action={revokeAgentAction}
                                  workspace={slug}
                                  fields={{ agentId: agent.id }}
                                  confirm={`Revoke ${agent.name}? It loses access immediately; its past work stays.`}
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
            </div>
          )}
        </Card>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="MCP endpoint" description="Streamable HTTP, authenticated with a bearer token." />
            <CardBody>
              <CopyField value={mcpUrl} surface="fill" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="What agents get" />
            <CardBody>
              <ul className="list-disc space-y-1.5 pl-4 text-xs text-ink-2 marker:text-faint">
                <li>An operating guide and prompts for syncing, scanning sources, and triage.</li>
                <li>Tools to capture, claim, and complete tasks, and to propose and plan goals.</li>
                <li>Shared memory, so one agent&apos;s findings are every agent&apos;s context.</li>
                <li>Mermaid views of the goal tree, board, and timeline.</li>
                <li>A webhook each, so a bot hears about your decisions and changes to the work it follows as they happen.</li>
              </ul>
              <p className="mt-3 text-xs text-muted">Agents can propose goals but only people can approve, complete, or abandon them.</p>
            </CardBody>
          </Card>
        </div>
      </div>
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
