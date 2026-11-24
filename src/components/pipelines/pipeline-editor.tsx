"use client";

import { ArrowDown, ArrowUp, GitBranch, GitFork, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { updatePipelineAction } from "@/app/w/[slug]/actions";
import { APPROVER_ROLES, FAILURE_ACTION_META, FAILURE_ACTIONS, JOIN_MODES, LIMITS, STOP_KIND_META, type ApproverRole, type FailureAction, type JoinMode, type StopKind } from "@/lib/domain";
import { addStopAfter, choiceAt, forkAt, freshId, joinsOf, moveStop, removeStop, tidyJoins } from "@/lib/pipeline-edit";
import { definitionProblems, normalizeDefinition, PIPELINE_LIMITS, type PipelineDefinition, type PipelineStop, type StopThen } from "@/lib/pipelines";

import { LineMap } from "../charts/line-map";
import { ActionForm } from "../ui/action-form";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";
import { SubmitButton } from "../ui/submit-button";

/** The kinds a person picks for a stop; `pipeline` stops wait for factories. */
const EDITABLE_KINDS = ["agent", "person", "any_agent"] as const satisfies readonly StopKind[];
const THEN_KINDS = { next: "Go on to a stop", fork: "Fork: several stops run side by side", choice: "Choice: one branch, picked by the result", end: "End the run" } as const;
type ThenKind = keyof typeof THEN_KINDS;
const ROLE_LABEL: Record<ApproverRole, string> = { admin: "Any owner or admin", member: "Any member" };

const thenKind = (then: StopThen): ThenKind => (then.next !== undefined ? "next" : then.fork ? "fork" : then.choice ? "choice" : "end");

interface EditorProps {
  slug: string;
  pipelineId: string;
  pipelineName: string;
  initial: PipelineDefinition;
  agents: readonly string[];
  people: readonly { id: string; email: string; name: string }[];
  /** Saving makes a new version; running trips keep theirs. */
  version: number;
}

function Group({ legend, children, actions }: { legend: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <fieldset className="surface space-y-3 rounded-lg border border-rule p-4">
      <legend className="sr-only">{legend}</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-hidden className="text-sm font-semibold text-ink">
          {legend}
        </p>
        {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      </div>
      {children}
    </fieldset>
  );
}

/**
 * The structured editor (the plan's Definition tab): an ordered list of stops, each with who serves
 * it, its instructions, what comes after it (next, fork, choice or end), its time limit and failure
 * rule, plus the ends and inputs; Add stop, Fork here and Add a choice insert branches. The map
 * beside it redraws as it changes, and the checks the server runs say what is wrong before saving.
 * One stored definition, so what agents write and what people edit never drift.
 */
export function PipelineEditor({ slug, pipelineId, pipelineName, initial, agents, people, version }: EditorProps) {
  const [definition, setDefinition] = useState<PipelineDefinition>(initial);
  const [reason, setReason] = useState("");
  const normalized = useMemo(() => normalizeDefinition(definition), [definition]);
  const problems = useMemo(() => definitionProblems(normalized), [normalized]);
  const joins = useMemo(() => joinsOf(definition), [definition]);
  const changed = JSON.stringify(definition) !== JSON.stringify(initial);
  const edit = (next: PipelineDefinition) => setDefinition(tidyJoins(next));
  const setStop = (id: string, patch: Partial<PipelineStop>) => edit({ ...definition, stops: definition.stops.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop)) });
  const stopName = (id: string) => definition.stops.find((stop) => stop.id === id)?.name ?? id;
  // A person is named by user id or email; either reads as their name.
  const personOf = (ref: string | undefined) => (ref ? people.find((person) => person.id === ref || person.email.toLowerCase() === ref.toLowerCase()) : undefined);
  const servedBy = Object.fromEntries(
    definition.stops.map((stop) => [
      stop.id,
      stop.kind === "agent" ? (stop.agent ?? "an agent") : stop.kind === "person" ? (personOf(stop.person)?.name ?? stop.person ?? (stop.role ? ROLE_LABEL[stop.role] : "a person")) : "any agent",
    ]),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4" data-pipeline-editor>
        {definition.stops.map((stop, index) => {
          const key = `stop-${index}`;
          const kind = thenKind(stop.then);
          const others = definition.stops.filter((candidate) => candidate.id !== stop.id);
          const targets = [...others.map((other) => ({ value: `stop:${other.id}`, label: `Stop: ${other.name}` })), ...definition.ends.map((end) => ({ value: `end:${end.id}`, label: `End: ${end.name}` }))];
          return (
            <Group
              key={key}
              legend={`${index + 1}. ${stop.name || "Unnamed stop"}`}
              actions={
                <>
                  <Button size="sm" variant="ghost" aria-label={`Move ${stop.name} up`} disabled={index === 0} onClick={() => edit(moveStop(definition, stop.id, -1))}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Move ${stop.name} down`} disabled={index === definition.stops.length - 1} onClick={() => edit(moveStop(definition, stop.id, 1))}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${stop.name}`} disabled={definition.stops.length <= 1} onClick={() => edit(removeStop(definition, stop.id))}>
                    <Trash2 aria-hidden />
                  </Button>
                </>
              }
            >
              <p className="text-xs text-muted">
                Id <code className="rounded-xs bg-fill px-1 font-mono text-ink-2">{stop.id}</code>
                {definition.start === stop.id && " · the first stop"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" htmlFor={`${key}-name`}>
                  <Input id={`${key}-name`} value={stop.name} maxLength={LIMITS.title} onChange={(event) => setStop(stop.id, { name: event.target.value })} />
                </Field>
                <Field label="Served by" htmlFor={`${key}-kind`}>
                  <Select
                    id={`${key}-kind`}
                    value={stop.kind}
                    onChange={(event) => {
                      const next = event.target.value as StopKind;
                      setStop(stop.id, {
                        kind: next,
                        agent: next === "agent" ? (agents[0] ?? "") : undefined,
                        person: undefined,
                        role: next === "person" ? "member" : undefined,
                        options: next === "person" && stop.then.choice ? stop.then.choice.map((branch) => branch.label) : [],
                        onTimeout: undefined,
                        blocking: true,
                        approvals: 1,
                      });
                    }}
                  >
                    {EDITABLE_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {STOP_KIND_META[value].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {stop.kind === "agent" && (
                  <Field label="Agent" htmlFor={`${key}-agent`} hint={agents.length ? undefined : "Connect an agent first, or let any agent pick it up."}>
                    <Select id={`${key}-agent`} value={stop.agent ?? ""} onChange={(event) => setStop(stop.id, { agent: event.target.value })}>
                      {!agents.includes(stop.agent ?? "") && <option value={stop.agent ?? ""}>{stop.agent || "Choose an agent"}</option>}
                      {agents.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {stop.kind === "person" && (
                  <Field label="Who decides" htmlFor={`${key}-person`}>
                    <Select
                      id={`${key}-person`}
                      value={stop.person ? `person:${personOf(stop.person)?.id ?? stop.person}` : `role:${stop.role ?? "member"}`}
                      onChange={(event) => {
                        const [what, value] = event.target.value.split(/:(.*)/) as [string, string];
                        setStop(stop.id, what === "person" ? { person: value, role: undefined, approvals: 1 } : { person: undefined, role: value as ApproverRole });
                      }}
                    >
                      {APPROVER_ROLES.map((role) => (
                        <option key={role} value={`role:${role}`}>
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                      {stop.person && !personOf(stop.person) && <option value={`person:${stop.person}`}>{stop.person}</option>}
                      {people.map((person) => (
                        <option key={person.id} value={`person:${person.id}`}>
                          {person.name} ({person.email})
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
              <Field label={stop.kind === "person" ? "Question for the person" : "Instructions (the handoff note)"} htmlFor={`${key}-instructions`} hint="May read {{input.name}}, {{stops.id.result}}, {{run.number}} and {{pipeline.name}}.">
                <Textarea id={`${key}-instructions`} value={stop.instructions} maxLength={PIPELINE_LIMITS.instructions} onChange={(event) => setStop(stop.id, { instructions: event.target.value })} />
              </Field>
              {stop.kind === "person" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {!stop.then.choice && (
                    <Field label="Options, comma separated" htmlFor={`${key}-options`}>
                      <Input
                        id={`${key}-options`}
                        value={stop.options.join(", ")}
                        onChange={(event) => setStop(stop.id, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })}
                      />
                    </Field>
                  )}
                  <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2">
                    <input type="checkbox" checked={!stop.blocking} disabled={Boolean(stop.then.choice)} onChange={(event) => setStop(stop.id, { blocking: !event.target.checked, onTimeout: undefined, approvals: 1 })} />
                    Advisory: tell them, and go on
                  </label>
                  {stop.role && stop.blocking && (
                    <Field label="People who must agree" htmlFor={`${key}-approvals`}>
                      <Input id={`${key}-approvals`} type="number" min={1} max={PIPELINE_LIMITS.approvals} value={stop.approvals} onChange={(event) => setStop(stop.id, { approvals: Math.max(1, Number(event.target.value) || 1) })} />
                    </Field>
                  )}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Time limit, minutes" htmlFor={`${key}-limit`} hint={stop.kind === "person" ? "Reminds at half; at the limit, takes the default." : "At the limit the stop fails."}>
                  <Input
                    id={`${key}-limit`}
                    type="number"
                    min={1}
                    max={PIPELINE_LIMITS.timeLimitMinutes}
                    value={stop.timeLimitMinutes ?? ""}
                    onChange={(event) => setStop(stop.id, { timeLimitMinutes: event.target.value ? Math.max(1, Number(event.target.value)) : undefined, ...(!event.target.value && { onTimeout: undefined }) })}
                  />
                </Field>
                {stop.kind === "person" && stop.blocking && stop.timeLimitMinutes && (
                  <Field label="At the limit, go with" htmlFor={`${key}-timeout`}>
                    <Select id={`${key}-timeout`} value={stop.onTimeout ?? ""} onChange={(event) => setStop(stop.id, { onTimeout: event.target.value || undefined })}>
                      <option value="">Nothing: the stop fails</option>
                      {normalized.stops.find((candidate) => candidate.id === stop.id)!.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {stop.kind !== "person" && (
                  <Field label="When it fails" htmlFor={`${key}-failure`}>
                    <Select
                      id={`${key}-failure`}
                      value={stop.onFailure.action}
                      onChange={(event) => setStop(stop.id, { onFailure: { action: event.target.value as FailureAction, times: stop.onFailure.times } })}
                    >
                      {FAILURE_ACTIONS.map((action) => (
                        <option key={action} value={action}>
                          {FAILURE_ACTION_META[action].label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {stop.kind !== "person" && (stop.onFailure.action === "retry" || stop.onFailure.action === "hand_back") && (
                  <Field label="Times" htmlFor={`${key}-times`}>
                    <Input
                      id={`${key}-times`}
                      type="number"
                      min={1}
                      max={PIPELINE_LIMITS.times}
                      value={stop.onFailure.times}
                      onChange={(event) => setStop(stop.id, { onFailure: { ...stop.onFailure, times: Math.max(1, Number(event.target.value) || 1) } })}
                    />
                  </Field>
                )}
                {joins.has(stop.id) && (
                  <Field label="Where branches meet" htmlFor={`${key}-join`}>
                    <Select id={`${key}-join`} value={stop.join ?? "all"} onChange={(event) => setStop(stop.id, { join: event.target.value as JoinMode })}>
                      {JOIN_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode === "all" ? "Wait for every branch" : "Go on with the first"}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>

              <div className="space-y-3 border-t border-rule pt-3">
                <Field label="After this stop" htmlFor={`${key}-then`}>
                  <Select
                    id={`${key}-then`}
                    value={kind}
                    onChange={(event) => {
                      const next = event.target.value as ThenKind;
                      const other = others[0]?.id;
                      const end = definition.ends[0]?.id;
                      const then: StopThen =
                        next === "next" && other ? { next: other } : next === "fork" && others.length >= 2 ? { fork: [others[0]!.id, others[1]!.id] } : next === "choice" && end ? { choice: [{ label: "Yes", ...(other ? { to: other } : { end }) }, { label: "No", end }] } : { end };
                      setStop(stop.id, { then, ...(stop.kind === "person" && { options: then.choice ? then.choice.map((branch) => branch.label) : stop.options, ...(then.choice && { blocking: true }) }) });
                    }}
                  >
                    {(Object.keys(THEN_KINDS) as ThenKind[]).map((value) => (
                      <option key={value} value={value} disabled={(value === "fork" && others.length < 2) || (value === "next" && others.length === 0)}>
                        {THEN_KINDS[value]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {kind === "next" && (
                  <Field label="Next stop" htmlFor={`${key}-next`}>
                    <Select id={`${key}-next`} value={stop.then.next} onChange={(event) => setStop(stop.id, { then: { next: event.target.value } })}>
                      {others.map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {kind === "end" && (
                  <Field label="End" htmlFor={`${key}-end`}>
                    <Select id={`${key}-end`} value={stop.then.end ?? ""} onChange={(event) => setStop(stop.id, { then: { end: event.target.value } })}>
                      {definition.ends.map((end) => (
                        <option key={end.id} value={end.id}>
                          {end.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {kind === "fork" && (
                  <fieldset>
                    <legend className="mb-1.5 text-xs font-semibold text-ink-2">Runs side by side</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {others.map((other) => (
                        <label key={other.id} className="flex items-center gap-1.5 text-sm text-ink-2">
                          <input
                            type="checkbox"
                            checked={stop.then.fork!.includes(other.id)}
                            onChange={(event) => setStop(stop.id, { then: { fork: event.target.checked ? [...stop.then.fork!, other.id] : stop.then.fork!.filter((id) => id !== other.id) } })}
                          />
                          {other.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {kind === "choice" && (
                  <div className="space-y-2">
                    {stop.then.choice!.map((branch, branchIndex) => {
                      const branchKey = `${key}-branch-${branchIndex}`;
                      const setBranches = (choice: NonNullable<StopThen["choice"]>) =>
                        setStop(stop.id, { then: { ...stop.then, choice }, ...(stop.kind === "person" && { options: choice.map((entry) => entry.label) }) });
                      return (
                        <div key={branchKey} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                          <Field label={`Branch ${branchIndex + 1} label`} htmlFor={`${branchKey}-label`}>
                            <Input
                              id={`${branchKey}-label`}
                              value={branch.label}
                              maxLength={LIMITS.option}
                              onChange={(event) => setBranches(stop.then.choice!.map((entry, at) => (at === branchIndex ? { ...entry, label: event.target.value } : entry)))}
                            />
                          </Field>
                          <Field label="Goes to" htmlFor={`${branchKey}-to`}>
                            <Select
                              id={`${branchKey}-to`}
                              value={branch.to ? `stop:${branch.to}` : `end:${branch.end}`}
                              onChange={(event) => {
                                const [what, id] = event.target.value.split(/:(.*)/) as [string, string];
                                setBranches(stop.then.choice!.map((entry, at) => (at === branchIndex ? { label: entry.label, ...(what === "stop" ? { to: id } : { end: id }) } : entry)));
                              }}
                            >
                              {targets.map((target) => (
                                <option key={target.value} value={target.value}>
                                  {target.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Button size="sm" variant="ghost" aria-label={`Remove branch ${branch.label}`} disabled={stop.then.choice!.length <= 2} onClick={() => setBranches(stop.then.choice!.filter((_, at) => at !== branchIndex))}>
                            <Trash2 aria-hidden />
                          </Button>
                        </div>
                      );
                    })}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={stop.then.choice!.length >= PIPELINE_LIMITS.branches || definition.ends.length === 0}
                      onClick={() => {
                        const choice = [...stop.then.choice!, { label: `Option ${stop.then.choice!.length + 1}`, end: definition.ends[0]!.id }];
                        setStop(stop.id, { then: { ...stop.then, choice }, ...(stop.kind === "person" && { options: choice.map((entry) => entry.label) }) });
                      }}
                    >
                      <Plus aria-hidden />
                      Add a branch
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" onClick={() => edit(addStopAfter(definition, stop.id))}>
                    <Plus aria-hidden />
                    Add stop after
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => edit(forkAt(definition, stop.id))}>
                    <GitFork aria-hidden />
                    Fork here
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!definition.ends.length} onClick={() => edit(choiceAt(definition, stop.id))}>
                    <GitBranch aria-hidden />
                    Add a choice
                  </Button>
                </div>
              </div>
            </Group>
          );
        })}

        <Group
          legend="Ends"
          actions={
            <Button
              size="sm"
              variant="ghost"
              disabled={definition.ends.length >= PIPELINE_LIMITS.ends}
              onClick={() => edit({ ...definition, ends: [...definition.ends, { id: freshId(definition, "end"), name: "New end" }] })}
            >
              <Plus aria-hidden />
              Add an end
            </Button>
          }
        >
          {definition.ends.map((end, index) => (
            <div key={`end-${index}`} className="flex items-end gap-2">
              <Field label={`End ${index + 1}`} htmlFor={`end-${index}-name`} className="flex-1">
                <Input id={`end-${index}-name`} value={end.name} maxLength={LIMITS.name} onChange={(event) => edit({ ...definition, ends: definition.ends.map((candidate, at) => (at === index ? { ...candidate, name: event.target.value } : candidate)) })} />
              </Field>
              <Button size="sm" variant="ghost" aria-label={`Remove the end ${end.name}`} disabled={definition.ends.length <= 1} onClick={() => edit({ ...definition, ends: definition.ends.filter((_, at) => at !== index) })}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
        </Group>

        <Group
          legend="Inputs a run starts with"
          actions={
            <Button
              size="sm"
              variant="ghost"
              disabled={definition.inputs.length >= PIPELINE_LIMITS.inputs}
              onClick={() => edit({ ...definition, inputs: [...definition.inputs, { name: `input_${definition.inputs.length + 1}`, description: "", required: false }] })}
            >
              <Plus aria-hidden />
              Add an input
            </Button>
          }
        >
          {definition.inputs.length === 0 && <p className="text-sm text-muted">None: runs start with nothing to fill in.</p>}
          {definition.inputs.map((input, index) => {
            const setInput = (patch: Partial<typeof input>) => edit({ ...definition, inputs: definition.inputs.map((candidate, at) => (at === index ? { ...candidate, ...patch } : candidate)) });
            return (
              <div key={`input-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-end gap-2">
                <Field label="Name" htmlFor={`input-${index}-name`}>
                  <Input id={`input-${index}-name`} value={input.name} onChange={(event) => setInput({ name: event.target.value })} />
                </Field>
                <Field label="What it is" htmlFor={`input-${index}-description`}>
                  <Input id={`input-${index}-description`} value={input.description} onChange={(event) => setInput({ description: event.target.value })} />
                </Field>
                <div className="flex items-center gap-1 pb-1">
                  <label className="flex items-center gap-1.5 text-xs text-ink-2">
                    <input type="checkbox" checked={input.required} onChange={(event) => setInput({ required: event.target.checked })} />
                    Required
                  </label>
                  <Button size="sm" variant="ghost" aria-label={`Remove the input ${input.name}`} onClick={() => edit({ ...definition, inputs: definition.inputs.filter((_, at) => at !== index) })}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
            );
          })}
        </Group>
      </div>

      <div className="min-w-0 space-y-4 lg:sticky lg:top-32 lg:self-start">
        <section aria-label="Preview" className="surface rounded-lg border border-rule p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Preview</h3>
          {problems.length === 0 || normalized.stops.some((stop) => stop.id === normalized.start) ? (
            <LineMap definition={normalized} label={`Preview of ${pipelineName}'s line`} servedBy={servedBy} />
          ) : null}
        </section>
        <ActionForm
          action={updatePipelineAction}
          workspace={slug}
          notice={`Saved “${pipelineName}”; new runs ride the new version`}
          analytics={{ event: "pipeline_save_version", params: { stops_count: normalized.stops.length } }}
          className="surface space-y-3 rounded-lg border border-rule p-4"
        >
          <input type="hidden" name="pipelineId" value={pipelineId} />
          <input type="hidden" name="definition" value={JSON.stringify(normalized)} />
          {problems.length > 0 ? (
            <div role="status" data-problems className="space-y-1">
              <p className="text-xs font-semibold text-late-ink">Fix {problems.length === 1 ? "this" : `these ${problems.length}`} to save:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-late-ink">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p role="status" className="text-xs text-muted">
              {changed ? `Saving makes version ${version + 1}. Runs under way keep the version they started on.` : `This is version ${version}.`}
            </p>
          )}
          <Field label="Why (optional)" htmlFor="pipeline-reason">
            <Input id="pipeline-reason" name="reason" value={reason} maxLength={LIMITS.note} onChange={(event) => setReason(event.target.value)} placeholder="Review now waits a day" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton size="sm" variant="primary" disabled={!changed || problems.length > 0}>
              Save version
            </SubmitButton>
            <Button size="sm" variant="ghost" disabled={!changed} onClick={() => setDefinition(initial)}>
              Discard changes
            </Button>
            <span className="sr-only">{`${stopName(definition.start)} is the first stop.`}</span>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}
