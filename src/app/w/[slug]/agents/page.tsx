import { Bot, Plug } from "lucide-react";
import type { Metadata } from "next";

import { revokeAgentAction } from "@/app/w/[slug]/actions";
import { AGENT_STATUS_META, agentStatus } from "@/components/agent-list";
import { ConnectAgentForm } from "@/components/connect-agent-form";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/ui/action-form";
import { MetaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listAgents } from "@/server/domain/agents";
import { can } from "@/server/domain/policy";
import { absoluteUrl } from "@/server/web";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage({ params }: PageProps<"/w/[slug]/agents">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const [agents, mcpUrl] = await Promise.all([listAgents(ctx, {}), absoluteUrl(routes.mcp())]);
  const canManage = can(ctx.actor, "agent:manage");

  return (
    <>
      <PageHeader
        title="Agents"
        description="Every agent connected to this workspace shares its goals, tasks, and memory. Each has its own token, so its work is attributed and it can be cut off on its own."
      />

      {canManage && (
        <Card className="mb-6">
          <CardHeader title="Connect an agent" description="Issue a token, then paste the snippet into your MCP client." icon={<Plug />} />
          <CardBody>
            <ConnectAgentForm slug={slug} mcpUrl={mcpUrl} />
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Connected agents" icon={<Bot />} />
          {agents.length === 0 ? (
            <EmptyState icon={<Bot />} title="No agents yet">
              {canManage ? "Issue a token to connect your first agent." : "Ask a workspace admin to connect an agent."}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                    <th className="px-5 py-2.5 font-medium">Agent</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">Last seen</th>
                    <th className="px-3 py-2.5 font-medium">Connected</th>
                    {canManage && <th className="px-5 py-2.5" aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {agents.map((agent) => {
                    const status = agentStatus(agent);
                    return (
                      <tr key={agent.id} className={cx(status === "revoked" && "text-zinc-400")}>
                        <td className="px-5 py-3">
                          <p className={cx("font-medium", status !== "revoked" && "text-zinc-900")}>{agent.name}</p>
                          <p className="font-mono text-xs text-zinc-400">{agent.tokenPrefix}…</p>
                        </td>
                        <td className="px-3 py-3">
                          <MetaBadge meta={AGENT_STATUS_META} value={status} />
                        </td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap text-zinc-500">{timeAgo(agent.lastSeenAt)}</td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap text-zinc-500">{timeAgo(agent.createdAt)}</td>
                        {canManage && (
                          <td className="px-5 py-3 text-right">
                            {status !== "revoked" && (
                              <ActionForm
                                action={revokeAgentAction}
                                workspace={slug}
                                confirm={`Revoke ${agent.name}? It loses access immediately; its past work stays.`}
                                quiet
                              >
                                <input type="hidden" name="agentId" value={agent.id} />
                                <SubmitButton size="sm" variant="danger">
                                  Revoke
                                </SubmitButton>
                              </ActionForm>
                            )}
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

        <div className="space-y-6">
          <Card>
            <CardHeader title="MCP endpoint" description="Streamable HTTP, authenticated with a bearer token." icon={<Plug />} />
            <CardBody className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-800">
                {mcpUrl}
              </code>
              <CopyButton value={mcpUrl} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="What agents get" />
            <CardBody>
              <ul className="list-disc space-y-1.5 pl-4 text-xs text-zinc-600">
                <li>An operating guide and prompts for syncing, scanning sources, and triage.</li>
                <li>Tools to capture, claim, and complete tasks, and to propose and plan goals.</li>
                <li>Shared memory, so one agent&apos;s findings are every agent&apos;s context.</li>
                <li>Mermaid views of the goal tree, board, and timeline.</li>
              </ul>
              <p className="mt-3 text-xs text-zinc-500">Agents can propose goals but only people can approve, complete, or abandon them.</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
