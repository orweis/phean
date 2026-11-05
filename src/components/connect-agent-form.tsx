"use client";

import { KeyRound, Plus, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import { createAgentAction } from "@/app/w/[slug]/actions";
import { stringData } from "@/lib/action-state";
import { LIMITS } from "@/lib/domain";
import { mcpClientSetups, type McpClientSetup } from "@/lib/mcp-config";

import { ActionForm } from "./ui/action-form";
import { CopyButton, CopyField } from "./ui/copy-button";
import { Field, Input, Select } from "./ui/field";
import { segment, SEGMENTED } from "./ui/segmented";
import { SubmitButton } from "./ui/submit-button";

/**
 * How most agents connect: the URL alone. The client gets a 401, finds Phean's sign-in, and opens
 * it in the person's browser to approve the agent, so there is no key to copy or leak.
 */
export function SignInSetup({ slug, mcpUrl }: { slug: string; mcpUrl: string }) {
  const setups = mcpClientSetups({ url: mcpUrl, workspace: slug });
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-ink-2">MCP endpoint</p>
        <p className="mt-0.5 mb-2 text-xs text-muted">Streamable HTTP. Clients sign in with OAuth; a bot can send a fixed key instead.</p>
        <CopyField value={mcpUrl} surface="fill" />
      </div>
      <ClientSnippets setups={setups} pick="Client">
        <p className="mt-2 text-xs text-muted">
          The first time the agent connects, Phean opens in your browser. Name the agent, pick its access and how long it lasts, and allow it. Add each
          workspace under its own name, as here.
        </p>
      </ClientSnippets>
    </div>
  );
}

/**
 * Snippets per client with a switch between them. The fixed-key reveal uses tabs (`pick` unset);
 * the sign-in setup uses a group of pressed buttons, so a page with both has one tab list.
 */
function ClientSnippets({ setups, pick, children }: { setups: McpClientSetup[]; pick?: string; children?: ReactNode }) {
  const [selected, setSelected] = useState(setups[0]!.id);
  const setup = setups.find((candidate) => candidate.id === selected) ?? setups[0]!;
  const tabs = !pick;
  return (
    <div>
      <div role={tabs ? "tablist" : "group"} aria-label={pick ?? "MCP client"} className={`${SEGMENTED} w-fit`}>
        {setups.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role={tabs ? "tab" : undefined}
            aria-selected={tabs ? candidate.id === setup.id : undefined}
            aria-pressed={tabs ? undefined : candidate.id === setup.id}
            onClick={() => setSelected(candidate.id)}
            className={segment(candidate.id === setup.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <div role={tabs ? "tabpanel" : undefined} className="mt-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-2">{setup.where}</p>
          <CopyButton value={setup.code} variant="ghost" />
        </div>
        <pre className="overflow-x-auto rounded-md bg-dusk p-3 font-mono text-xs leading-relaxed text-dusk-ink">{setup.code}</pre>
        {children}
      </div>
    </div>
  );
}

/**
 * Issues a fixed key, for a bot that runs unattended and cannot sign in through a browser, and
 * shows it exactly once with setup snippets that carry it. Given agents that can take sub-agents,
 * it can issue the key as one of theirs.
 */
export function ConnectAgentForm({ slug, mcpUrl, parents = [] }: { slug: string; mcpUrl: string; parents?: readonly { id: string; name: string }[] }) {
  return (
    <ActionForm action={createAgentAction} workspace={slug}>
      {(state) => {
        const issued = stringData(state, "token", "agentName");
        return (
          <>
            <p className="mb-3 text-xs text-ink-2">
              For a bot that runs unattended and cannot open a browser. A fixed key does not expire, so revoke it when the bot retires.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Agent name" htmlFor="agent-name" className="min-w-48 flex-1">
                <Input id="agent-name" name="name" required maxLength={LIMITS.name} placeholder="Nightly triage bot" />
              </Field>
              {parents.length > 0 && (
                <Field label="Sub-agent of" htmlFor="agent-parent" className="w-48 max-sm:w-full">
                  <Select id="agent-parent" name="parentAgentId" defaultValue="">
                    <option value="">None: its own agent</option>
                    {parents.map((parent) => (
                      <option key={parent.id} value={parent.id}>
                        {parent.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <SubmitButton variant="primary">
                <Plus aria-hidden />
                Issue key
              </SubmitButton>
            </div>
            <p className="mt-1.5 text-xs text-muted">The name appears next to everything the bot does. Issue one key per bot so each can be revoked on its own.</p>
            {issued && <TokenReveal {...issued} slug={slug} mcpUrl={mcpUrl} key={issued.token} />}
          </>
        );
      }}
    </ActionForm>
  );
}

function TokenReveal({ token, agentName, slug, mcpUrl }: { token: string; agentName: string; slug: string; mcpUrl: string }) {
  return (
    <div className="mt-4 space-y-4 rounded-lg border border-arrive/40 bg-arrive-tint p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <KeyRound className="size-4 text-arrive-ink" aria-hidden />
          Key for {agentName}
        </p>
        <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-wait-ink">
          <TriangleAlert className="size-3.5" aria-hidden />
          Copy it now. Phean only keeps a hash, so it cannot be shown again.
        </p>
        <div className="mt-2">
          <CopyField value={token} />
        </div>
      </div>

      <ClientSnippets setups={mcpClientSetups({ url: mcpUrl, token, workspace: slug })}>
        <p className="mt-2 text-xs text-muted">
          Sub-agents can share this key: give each a <code className="font-mono">Phean-Agent-Name</code> header (or{" "}
          <code className="font-mono">?agent=Name</code> on the URL) and Phean lists it under {agentName} by that name.
        </p>
      </ClientSnippets>
    </div>
  );
}
