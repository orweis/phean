"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { decideConsentAction } from "@/app/oauth/approve/actions";
import type { ActionState } from "@/lib/action-state";
import { cx } from "@/lib/cx";
import { addDays, dayOf } from "@/lib/dates";
import { ACCESS_LEVEL_META, AGENT_ACCESS_LEVELS, AGENT_LIFETIME_DAYS, DEFAULT_AGENT_LIFETIME_DAYS, LIMITS, lifetimeLabel, type AgentAccessLevel } from "@/lib/domain";
import { formatLongDay } from "@/lib/format";
import { consentLeavingText, levelField, renewalKey, type ConsentOutcome } from "@/lib/oauth-consent";

import { ActionForm } from "./ui/action-form";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";
import { RADIO_SEGMENT, SEGMENTED } from "./ui/segmented";

const DEFAULT_LEVEL: AgentAccessLevel = "write";

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
        if (state.status === "success" && typeof navigate === "string") return <Leaving navigate={navigate} text={consentLeavingText(outcome as ConsentOutcome, clientName)} />;
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

function AllowButton({ disabled = false }: { disabled?: boolean }) {
  const { pending, data } = useFormStatus();
  return (
    <Button type="submit" variant="primary" name="decision" value="allow" disabled={pending || disabled} pending={pending && data?.get("decision") !== "decline"}>
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

/** A choice of workspace and name already known to replace a connection, and whether that agent last connected from another client. */
export interface KnownRenewal {
  key: string;
  otherClient: boolean;
}

interface ApproveAgentFormProps {
  oauthQuery: string;
  clientName: string;
  /** The client's own name: the agent name wherever this person has not approved this client before. */
  defaultName: string;
  /** `lastName`: what this person last approved this client as in that workspace, offered so reconnecting renews it. */
  workspaces: readonly { slug: string; name: string; levels: readonly AgentAccessLevel[]; lastName?: string }[];
  renewals: readonly KnownRenewal[];
  /** The levels the client's scope names, lowest first; empty when it names none. */
  asked: readonly AgentAccessLevel[];
  /** The levels a token for this request can honestly be issued at (`issuableLevels`). */
  issuable: readonly AgentAccessLevel[];
  /** The server's UTC day, so the end date cannot differ between server and browser. */
  today: string;
}

/** "Read", "Read and Write", "Read, Write and Admin". */
function levelList(levels: readonly AgentAccessLevel[]): string {
  const labels = levels.map((level) => ACCESS_LEVEL_META[level].label);
  return labels.length < 2 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Every input is controlled, because React resets a form after its action and a re-prompt must keep
 * what was chosen. Each row's levels are a radio group of their own, so arrow keys stay in that
 * workspace; picking a level picks its row, and only the chosen row's level is posted.
 */
export function ApproveAgentForm({ oauthQuery, clientName, defaultName, workspaces, renewals, asked, issuable, today }: ApproveAgentFormProps) {
  // A level is offered only where the person's role grants it and a token can say it.
  const offered = (slug: string | null) => workspaces.find((candidate) => candidate.slug === slug)?.levels.filter((option) => issuable.includes(option)) ?? [];
  const firstLevel = (slug: string | null) => {
    const levels = offered(slug);
    return levels.includes(DEFAULT_LEVEL) ? DEFAULT_LEVEL : (levels[0] ?? DEFAULT_LEVEL);
  };
  const unavailable = AGENT_ACCESS_LEVELS.filter((option) => !issuable.includes(option));
  // With a choice of workspaces nothing is preselected: which one a client reaches should be a decision.
  const [workspace, setWorkspace] = useState(workspaces.length === 1 && offered(workspaces[0]!.slug).length > 0 ? workspaces[0]!.slug : null);
  const nameFor = (slug: string | null) => workspaces.find((candidate) => candidate.slug === slug)?.lastName ?? defaultName;
  const [name, setName] = useState(() => nameFor(workspace));
  // Until the person types a name, choosing a workspace offers the name they last approved this client as there.
  const [named, setNamed] = useState(false);
  const [level, setLevel] = useState(() => firstLevel(workspace));
  const [days, setDays] = useState<number>(DEFAULT_AGENT_LIFETIME_DAYS);

  const pick = (slug: string, picked: AgentAccessLevel) => {
    if (!named && slug !== workspace) setName(nameFor(slug));
    setWorkspace(slug);
    setLevel(picked);
  };

  return (
    <ConsentForm oauthQuery={oauthQuery} clientName={clientName}>
      {(state) => {
        const key = workspace && renewalKey(workspace, name);
        const known = renewals.find((renewal) => renewal.key === key);
        const prompted = key !== null && state.data?.replaces === key;
        const replaces = key !== null && (!!known || prompted);
        const otherClient = known ? known.otherClient : prompted && state.data?.otherClient === true;
        return (
          <>
            {asked.length > 0 && <p className="mt-4 text-sm text-ink-2">This client asks for {levelList(asked)} access.</p>}
            <p className="mt-4 text-sm text-ink-2">Choose the one workspace it can work in.</p>
            <Field label="Agent name" htmlFor="agent-name" className="mt-4">
              <Input
                id="agent-name"
                name="name"
                required
                maxLength={LIMITS.name}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNamed(true);
                }}
              />
            </Field>

            <fieldset className="mt-4">
              <legend className="mb-1.5 text-xs font-semibold text-ink-2">Workspace and access</legend>
              <div className="divide-y divide-rule overflow-hidden rounded-lg border border-rule">
                {workspaces.map(({ slug, name: workspaceName, levels }) => {
                  const selected = workspace === slug;
                  const blocked = offered(slug).length === 0;
                  return (
                    <div key={slug} className={cx("flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5", selected && "bg-accent-tint")}>
                      <label className={cx("flex min-w-0 items-center gap-2 text-sm font-semibold", blocked ? "cursor-not-allowed text-muted" : "cursor-pointer text-ink")}>
                        <input
                          type="radio"
                          name="workspace"
                          value={slug}
                          required
                          disabled={blocked}
                          checked={selected}
                          onChange={() => pick(slug, firstLevel(slug))}
                          className="size-4 shrink-0 accent-accent"
                        />
                        <span className="min-w-0 wrap-anywhere">{workspaceName}</span>
                      </label>
                      <fieldset className={SEGMENTED}>
                        <legend className="sr-only">Access to {workspaceName}</legend>
                        {levels.map((option) => (
                          <label key={option} className={RADIO_SEGMENT}>
                            <input
                              type="radio"
                              name={levelField(slug)}
                              value={option}
                              disabled={!issuable.includes(option)}
                              checked={selected && level === option}
                              onChange={() => pick(slug, option)}
                              className="sr-only"
                            />
                            {ACCESS_LEVEL_META[option].label}
                          </label>
                        ))}
                      </fieldset>
                      {blocked && (
                        <p className="w-full text-xs text-muted">
                          Your role here can&apos;t give {levelList(asked)} access, which is what this client asks for. Ask a workspace owner or admin to connect it.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              {unavailable.length > 0 && (
                <p className="mt-1.5 text-xs text-muted">
                  {levelList(unavailable)} {unavailable.length === 1 ? "is" : "are"} unavailable, since this client asked only for {levelList(asked)}.
                </p>
              )}
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
              {replaces && (
                <p className="mt-4 rounded-md bg-wait-tint px-3 py-2 text-xs text-wait-ink">
                  You already have an agent with this name. Allowing replaces its connection.
                  {otherClient && " It last connected from a different client."}
                </p>
              )}
            </div>
            {/* Allow comes first in the document, so Enter in the name field means Allow; it is drawn last. */}
            <div className="mt-5 flex flex-row-reverse gap-2">
              <AllowButton disabled={workspaces.every(({ slug }) => offered(slug).length === 0)} />
              <CancelButton />
            </div>
          </>
        );
      }}
    </ConsentForm>
  );
}
