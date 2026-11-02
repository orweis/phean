"use client";

import { KeyRound, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { createAgentAction } from "@/app/w/[slug]/actions";
import type { ActionState } from "@/lib/action-state";
import { cx } from "@/lib/cx";
import { mcpClientSetups } from "@/lib/mcp-config";

import { ActionForm } from "./ui/action-form";
import { CopyButton } from "./ui/copy-button";
import { Field, Input } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

function issuedToken(state: ActionState): { token: string; agentName: string } | null {
  const { token, agentName } = state.data ?? {};
  return typeof token === "string" && typeof agentName === "string" ? { token, agentName } : null;
}

/** Issues an agent token and shows it exactly once, with setup snippets for common MCP clients. */
export function ConnectAgentForm({ slug, mcpUrl }: { slug: string; mcpUrl: string }) {
  return (
    <ActionForm action={createAgentAction} workspace={slug}>
      {(state) => {
        const issued = issuedToken(state);
        return (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Agent name" htmlFor="agent-name" className="min-w-56 flex-1">
                <Input id="agent-name" name="name" required maxLength={80} placeholder="Claude on Or's laptop" />
              </Field>
              <SubmitButton variant="primary">
                <Plus aria-hidden />
                Issue token
              </SubmitButton>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">
              The name appears next to everything the agent does. Issue one token per agent so each can be revoked on its own.
            </p>
            {issued && <TokenReveal {...issued} slug={slug} mcpUrl={mcpUrl} key={issued.token} />}
          </>
        );
      }}
    </ActionForm>
  );
}

function TokenReveal({ token, agentName, slug, mcpUrl }: { token: string; agentName: string; slug: string; mcpUrl: string }) {
  const setups = mcpClientSetups({ url: mcpUrl, token, workspace: slug });
  const [selected, setSelected] = useState(setups[0]!.id);
  const setup = setups.find((candidate) => candidate.id === selected) ?? setups[0]!;

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
          <KeyRound className="size-4 text-emerald-600" aria-hidden />
          Token for {agentName}
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs text-amber-800">
          <TriangleAlert className="size-3.5" aria-hidden />
          Copy it now. Phean only keeps a hash, so it cannot be shown again.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-800">
            {token}
          </code>
          <CopyButton value={token} />
        </div>
      </div>

      <div>
        <div role="tablist" aria-label="MCP client" className="flex gap-1">
          {setups.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={candidate.id === setup.id}
              onClick={() => setSelected(candidate.id)}
              className={cx(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                candidate.id === setup.id ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-white",
              )}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="mt-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">{setup.where}</p>
            <CopyButton value={setup.code} variant="ghost" />
          </div>
          <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-3 font-mono text-xs leading-relaxed text-zinc-100">{setup.code}</pre>
        </div>
      </div>
    </div>
  );
}
