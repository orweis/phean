"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { decideConsentAction, type ConsentOutcome } from "@/app/oauth/approve/actions";
import type { ActionState } from "@/lib/action-state";
import { cx } from "@/lib/cx";
import { addDays, dayOf } from "@/lib/dates";
import { ACCESS_LEVEL_META, AGENT_LIFETIME_DAYS, DEFAULT_AGENT_LIFETIME_DAYS, LIMITS, lifetimeLabel, type AgentAccessLevel } from "@/lib/domain";
import { formatLongDay } from "@/lib/format";
import { renewalKey } from "@/lib/oauth-consent";

import { ActionForm } from "./ui/action-form";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";
import { RADIO_SEGMENT, SEGMENTED } from "./ui/segmented";

const DEFAULT_LEVEL: AgentAccessLevel = "write";

const LEAVING_TEXT: Record<ConsentOutcome, (clientName: string) => string> = {
  allowed: (clientName) => `Connected. Go back to ${clientName}. You can close this window.`,
  declined: () => "Cancelled. Nothing was connected. You can close this window.",
  resume: () => "Taking you back to sign in.",
};

/** Sends the browser on. A custom scheme leaves this page on screen, so it says what happened instead of keeping a live Allow. */
function Leaving({ navigate, text }: { navigate: string; text: string }) {
  useEffect(() => {
    window.location.assign(navigate);
  }, [navigate]);
  return (
    <p role="status" className="mt-5 text-sm wrap-anywhere text-ink">
      {text}
    </p>
  );
}

function ConsentForm({ oauthQuery, clientName, children }: { oauthQuery: string; clientName: string; children: (state: ActionState) => ReactNode }) {
  return (
    <ActionForm action={decideConsentAction} quiet>
      {(state) => {
        const { navigate, outcome } = state.data ?? {};
        if (state.status === "success" && typeof navigate === "string") return <Leaving navigate={navigate} text={LEAVING_TEXT[outcome as ConsentOutcome](clientName)} />;
        return (
          <>
            <input type="hidden" name="oauthQuery" value={oauthQuery} />
            {children(state)}
          </>
        );
      }}
    </ActionForm>
  );
}

function CancelButton() {
  const { pending, data } = useFormStatus();
  return (
    // No validation: leaving needs no valid form.
    <Button type="submit" name="decision" value="decline" formNoValidate disabled={pending} pending={pending && data?.get("decision") === "decline"}>
      Cancel
    </Button>
  );
}

function AllowButton() {
  const { pending, data } = useFormStatus();
  return (
    <Button type="submit" variant="primary" name="decision" value="allow" disabled={pending} pending={pending && data?.get("decision") !== "decline"}>
      Allow
    </Button>
  );
}

/** Cancel on its own, for a person who has no workspace to choose. */
export function DeclineConsentForm({ oauthQuery, clientName }: { oauthQuery: string; clientName: string }) {
  return (
    <ConsentForm oauthQuery={oauthQuery} clientName={clientName}>
      {() => (
        <div className="flex justify-end">
          <CancelButton />
        </div>
      )}
    </ConsentForm>
  );
}

interface ApproveAgentFormProps {
  oauthQuery: string;
  clientName: string;
  defaultName: string;
  workspaces: readonly { slug: string; name: string; levels: readonly AgentAccessLevel[] }[];
  /** `renewalKey`s of the choices already known to replace a connection. */
  renewableKeys: readonly string[];
  /** The server's UTC day, so the end date cannot differ between server and browser. */
  today: string;
}

/**
 * Every input is controlled, because React resets a form after its action and a re-prompt must keep
 * what was chosen. The level radios share one name across the rows: there is one workspace and
 * one level to choose, and picking a level picks its row.
 */
export function ApproveAgentForm({ oauthQuery, clientName, defaultName, workspaces, renewableKeys, today }: ApproveAgentFormProps) {
  const [name, setName] = useState(defaultName);
  // With a choice of workspaces nothing is preselected: which one a client reaches should be a decision.
  const [workspace, setWorkspace] = useState(workspaces.length === 1 ? workspaces[0]!.slug : null);
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [days, setDays] = useState<number>(DEFAULT_AGENT_LIFETIME_DAYS);

  const pick = (slug: string, picked: AgentAccessLevel) => {
    setWorkspace(slug);
    setLevel(picked);
  };

  return (
    <ConsentForm oauthQuery={oauthQuery} clientName={clientName}>
      {(state) => {
        const key = workspace && renewalKey(workspace, name);
        const replaces = key !== null && (renewableKeys.includes(key) || state.data?.replaces === key);
        return (
          <>
            <p className="mt-4 text-sm text-ink-2">Choose the one workspace it can work in.</p>
            <Field label="Agent name" htmlFor="agent-name" className="mt-4">
              <Input id="agent-name" name="name" required maxLength={LIMITS.name} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>

            <fieldset className="mt-4">
              <legend className="mb-1.5 text-xs font-semibold text-ink-2">Workspace and access</legend>
              <div className="divide-y divide-rule overflow-hidden rounded-lg border border-rule">
                {workspaces.map(({ slug, name: workspaceName, levels }) => {
                  const selected = workspace === slug;
                  return (
                    <div key={slug} className={cx("flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5", selected && "bg-accent-tint")}>
                      <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
                        <input type="radio" name="workspace" value={slug} required checked={selected} onChange={() => pick(slug, DEFAULT_LEVEL)} className="size-4 shrink-0 accent-accent" />
                        <span className="min-w-0 wrap-anywhere">{workspaceName}</span>
                      </label>
                      <fieldset className={SEGMENTED}>
                        <legend className="sr-only">Access to {workspaceName}</legend>
                        {levels.map((option) => (
                          <label key={option} className={RADIO_SEGMENT}>
                            <input type="radio" name="level" value={option} checked={selected && level === option} onChange={() => pick(slug, option)} className="sr-only" />
                            {ACCESS_LEVEL_META[option].label}
                          </label>
                        ))}
                      </fieldset>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Read lets it look. Write lets it capture and work tasks. Admin can also see agents and members and revoke other agents.
                {workspaces.some(({ levels }) => !levels.includes("admin")) && " You can only give up to your own role."}
              </p>
            </fieldset>

            <fieldset className="mt-4">
              <legend className="mb-1.5 text-xs font-semibold text-ink-2">Access lasts</legend>
              <div className={SEGMENTED}>
                {AGENT_LIFETIME_DAYS.map((option) => (
                  <label key={option} className={cx(RADIO_SEGMENT, "whitespace-nowrap")}>
                    <input type="radio" name="lifetimeDays" value={option} checked={days === option} onChange={() => setDays(option)} className="sr-only" />
                    {lifetimeLabel(option)}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">Access ends on {formatLongDay(addDays(dayOf(today), days))}. Connect again to renew it.</p>
            </fieldset>

            <input type="hidden" name="replaces" value={replaces ? key : ""} />
            <div role="status">
              {replaces && <p className="mt-4 rounded-md bg-wait-tint px-3 py-2 text-xs text-wait-ink">You already have an agent with this name. Allowing replaces its connection.</p>}
            </div>
            {/* Allow comes first in the document, so Enter in the name field means Allow; it is drawn last. */}
            <div className="mt-5 flex flex-row-reverse gap-2">
              <AllowButton />
              <CancelButton />
            </div>
          </>
        );
      }}
    </ConsentForm>
  );
}
