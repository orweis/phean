"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { decideConsentAction } from "@/app/oauth/approve/actions";
import type { ActionState } from "@/lib/action-state";
import { cx } from "@/lib/cx";
import { addDays, dayOf } from "@/lib/dates";
import { ACCESS_LEVEL_META, AGENT_ACCESS_LEVELS, AGENT_LIFETIME_DAYS, DEFAULT_AGENT_LIFETIME_DAYS, LIMITS, lifetimeLabel, type AgentAccessLevel } from "@/lib/domain";
import { formatLongDay } from "@/lib/format";
import { consentAgentDetails, consentLeavingText, levelField, nameConflicts, NEW_AGENT, renewalKey, type ConsentAgent, type ConsentOutcome } from "@/lib/oauth-consent";

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

/** `confirm` asks first, for an Allow that also revokes: Enter in a field clicks this button too. */
function AllowButton({ disabled = false, confirm }: { disabled?: boolean; confirm?: string }) {
  const { pending, data } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      name="decision"
      value="allow"
      disabled={pending || disabled}
      pending={pending && data?.get("decision") !== "decline"}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
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

interface WorkspaceChoice {
  slug: string;
  name: string;
  levels: readonly AgentAccessLevel[];
  /** The person's own agents here, to reconnect one or take over its work. */
  agents: readonly ConsentAgent[];
  /** The agent this person last approved this client as here: the dialog's choice until they make another. */
  lastAgentId?: string;
}

interface ApproveAgentFormProps {
  oauthQuery: string;
  clientName: string;
  /** The client's own name: the new agent's name unless the person types another. */
  defaultName: string;
  workspaces: readonly WorkspaceChoice[];
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

/** "“A”", "“A” and “B”". */
const quotedList = (names: readonly string[]) => (names.length < 2 ? `“${names[0] ?? ""}”` : `${names.slice(0, -1).map((name) => `“${name}”`).join(", ")} and “${names.at(-1)}”`);

const CHECKBOX = "mt-0.5 size-4 shrink-0 accent-accent";

/**
 * Every input is controlled, because React resets a form after its action and a re-prompt must keep
 * what was chosen. Each row's levels are a radio group of their own, so arrow keys stay in that
 * workspace; picking a level picks its row, and only the chosen row's level is posted. In the chosen
 * workspace the person connects as one of their own agents there, renewing it, or as a new one, and
 * may give it the open claims of their other agents there.
 */
export function ApproveAgentForm({ oauthQuery, clientName, defaultName, workspaces, asked, issuable, today }: ApproveAgentFormProps) {
  // A level is offered only where the person's role grants it and a token can say it.
  const offered = (slug: string | null) => workspaces.find((candidate) => candidate.slug === slug)?.levels.filter((option) => issuable.includes(option)) ?? [];
  const firstLevel = (slug: string | null) => {
    const levels = offered(slug);
    return levels.includes(DEFAULT_LEVEL) ? DEFAULT_LEVEL : (levels[0] ?? DEFAULT_LEVEL);
  };
  const unavailable = AGENT_ACCESS_LEVELS.filter((option) => !issuable.includes(option));
  // With a choice of workspaces nothing is preselected: which one a client reaches should be a decision.
  const [workspace, setWorkspace] = useState(workspaces.length === 1 && offered(workspaces[0]!.slug).length > 0 ? workspaces[0]!.slug : null);
  const chosenWorkspace = workspaces.find((candidate) => candidate.slug === workspace);
  const ownAgents = chosenWorkspace?.agents ?? [];
  const agentFor = (slug: string | null) => workspaces.find((candidate) => candidate.slug === slug)?.lastAgentId ?? NEW_AGENT;
  // Which agent this connection becomes: one of the person's own, by id, or a new one (NEW_AGENT).
  const [agent, setAgent] = useState(() => agentFor(workspace));
  const [name, setName] = useState(defaultName);
  const [level, setLevel] = useState(() => firstLevel(workspace));
  const [days, setDays] = useState<number>(DEFAULT_AGENT_LIFETIME_DAYS);
  const [takeOver, setTakeOver] = useState<readonly string[]>([]);
  const [revoke, setRevoke] = useState<readonly string[]>([]);

  const pick = (slug: string, picked: AgentAccessLevel) => {
    if (slug !== workspace) {
      setAgent(agentFor(slug));
      setTakeOver([]);
      setRevoke([]);
    }
    setWorkspace(slug);
    setLevel(picked);
  };
  const reconnect = (id: string) => {
    setAgent(id);
    // An agent does not take over its own work.
    setTakeOver((ids) => ids.filter((other) => other !== id));
    setRevoke((ids) => ids.filter((other) => other !== id));
  };
  const toggle = (list: readonly string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((other) => other !== id));

  const reconnecting = ownAgents.find((candidate) => candidate.id === agent);
  const conflicts = reconnecting ? { agent: undefined, parentsOf: [] } : nameConflicts(ownAgents, name);
  // The agent Allow will become, by choice or because the typed name is already one of the person's.
  const becomes = reconnecting ?? conflicts.agent;
  const others = ownAgents.filter((candidate) => candidate.id !== becomes?.id);
  const revoking = others.filter((candidate) => revoke.includes(candidate.id) && takeOver.includes(candidate.id));
  const confirmRevoke = revoking.length
    ? `Revoke ${quotedList(revoking.map((candidate) => candidate.name))}? ${revoking.length === 1 ? "It and its sub-agents lose" : "They and their sub-agents lose"} access at once, and this cannot be undone.`
    : undefined;

  return (
    <ConsentForm oauthQuery={oauthQuery} clientName={clientName}>
      {(state) => {
        const key = workspace && !reconnecting ? renewalKey(workspace, name) : null;
        const prompted = key !== null && state.data?.replaces === key;
        const replaces = key !== null && (!!conflicts.agent || prompted);
        const otherClient = conflicts.agent ? !conflicts.agent.sameClient : prompted && state.data?.otherClient === true;
        return (
          <>
            {asked.length > 0 && <p className="mt-4 text-sm text-ink-2">This client asks for {levelList(asked)} access.</p>}
            <p className="mt-4 text-sm text-ink-2">Choose the one workspace it can work in.</p>

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

            {ownAgents.length > 0 && (
              <fieldset className="mt-4">
                <legend className="mb-1.5 text-xs font-semibold text-ink-2">Connect as</legend>
                <div className="divide-y divide-rule overflow-hidden rounded-lg border border-rule">
                  {ownAgents.map((candidate) => (
                    <div key={candidate.id} className={cx("px-3 py-2.5", agent === candidate.id && "bg-accent-tint")}>
                      <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
                        <input
                          type="radio"
                          name="agent"
                          value={candidate.id}
                          checked={agent === candidate.id}
                          onChange={() => reconnect(candidate.id)}
                          aria-describedby={`agent-${candidate.id}-details`}
                          className="size-4 shrink-0 accent-accent"
                        />
                        <span className="min-w-0 wrap-anywhere">{candidate.name}</span>
                      </label>
                      <p id={`agent-${candidate.id}-details`} className="mt-0.5 pl-6 text-xs wrap-anywhere text-muted">
                        {consentAgentDetails(candidate)}
                      </p>
                    </div>
                  ))}
                  <div className={cx("px-3 py-2.5", agent === NEW_AGENT && "bg-accent-tint")}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
                      <input type="radio" name="agent" value={NEW_AGENT} checked={agent === NEW_AGENT} onChange={() => reconnect(NEW_AGENT)} className="size-4 shrink-0 accent-accent" />
                      A new agent
                    </label>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-muted">Reconnecting keeps the agent&apos;s history, watches, sub-agents and claims, and replaces its old connection.</p>
              </fieldset>
            )}

            {!reconnecting && (
              <Field label="Agent name" htmlFor="agent-name" className="mt-4">
                <Input
                  id="agent-name"
                  name="name"
                  required
                  maxLength={LIMITS.name}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            )}

            <input type="hidden" name="replaces" value={replaces ? key : ""} />
            <div role="status">
              {replaces && (
                <p className="mt-4 rounded-md bg-wait-tint px-3 py-2 text-xs wrap-anywhere text-wait-ink">
                  You already have an agent named “{name.trim()}” here. Allowing reconnects it, keeping its history and claims, and replaces its connection. To keep it apart, choose another
                  name.
                  {otherClient && " It last connected from a different client."}
                </p>
              )}
              {conflicts.parentsOf.length > 0 && (
                <p className="mt-4 rounded-md bg-wait-tint px-3 py-2 text-xs wrap-anywhere text-wait-ink">
                  “{name.trim()}” is the name of a sub-agent of {quotedList(conflicts.parentsOf.map((parent) => parent.name))}. A new agent of this name is a separate agent; to act as that
                  sub-agent, connect as {conflicts.parentsOf.length === 1 ? "that agent" : "its parent"} and pass actingAs “{name.trim()}”.
                </p>
              )}
            </div>
            {replaces && conflicts.agent && (
              <Button type="button" size="choice" className="mt-2" onClick={() => reconnect(conflicts.agent!.id)}>
                Reconnect “{conflicts.agent.name}”
              </Button>
            )}

            {others.length > 0 && (
              <fieldset className="mt-4">
                <legend className="mb-1.5 text-xs font-semibold text-ink-2">Take over the work of</legend>
                <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule">
                  {others.map((candidate) => {
                    const taking = takeOver.includes(candidate.id);
                    return (
                      <li key={candidate.id} className="space-y-1.5 px-3 py-2.5">
                        <label className="flex min-w-0 cursor-pointer items-start gap-2 text-sm font-semibold text-ink">
                          <input
                            type="checkbox"
                            name="takeOver"
                            value={candidate.id}
                            checked={taking}
                            onChange={(event) => setTakeOver((ids) => toggle(ids, candidate.id, event.target.checked))}
                            aria-describedby={`take-${candidate.id}-claims`}
                            className={CHECKBOX}
                          />
                          <span className="min-w-0 wrap-anywhere">{candidate.name}</span>
                        </label>
                        <p id={`take-${candidate.id}-claims`} className="pl-6 text-xs text-muted">
                          {candidate.openClaims === 1 ? "1 open claim" : `${candidate.openClaims} open claims`}, its own and its sub-agents&apos;, move to this agent.
                        </p>
                        {taking && (
                          <label className="flex min-w-0 cursor-pointer items-start gap-2 pl-6 text-xs text-ink-2">
                            <input
                              type="checkbox"
                              name="revoke"
                              value={candidate.id}
                              checked={revoke.includes(candidate.id)}
                              onChange={(event) => setRevoke((ids) => toggle(ids, candidate.id, event.target.checked))}
                              className={CHECKBOX}
                            />
                            <span className="min-w-0 wrap-anywhere">Also revoke “{candidate.name}” and its sub-agents</span>
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1.5 text-xs text-muted">An open question on that work comes too, so its answer reaches this agent. Unless you revoke it, the other agent stays connected.</p>
              </fieldset>
            )}

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

            {/* Allow comes first in the document, so Enter in the name field means Allow; it is drawn last. */}
            <div className="mt-5 flex flex-row-reverse gap-2">
              <AllowButton disabled={workspaces.every(({ slug }) => offered(slug).length === 0)} confirm={confirmRevoke} />
              <CancelButton />
            </div>
          </>
        );
      }}
    </ConsentForm>
  );
}
