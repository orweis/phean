"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { saveWorkflowAction } from "@/app/w/[slug]/actions";
import { cx } from "@/lib/cx";
import { LANE_ORDER, LIMITS, TASK_STATUS_META, type Station } from "@/lib/domain";
import { isBuiltIn, MAX_STAGES, workflowProblem, type Stage } from "@/lib/workflow";

import { STATION_STYLE } from "./charts/stations";
import { ActionForm } from "./ui/action-form";
import { Button } from "./ui/button";
import { Input } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

/** A stage being edited; added ones have no key until saved. */
interface Draft extends Omit<Stage, "key"> {
  key?: string;
  /** Local identity for React and for moving rows, stable before a key exists. */
  id: string;
}

const KIND_HINTS: Record<Station, string> = {
  inbox: "Where agents drop new work to triage.",
  backlog: "Accepted, not planned yet.",
  todo: "Planned and ready to pick up.",
  in_progress: "Being worked on. Add steps such as Review.",
  done: "Finished. Add stages such as Shipped.",
};

let added = 0;

/**
 * The board's stages, by kind: rename or hide each kind's own stage, add stages of your own inside
 * a kind, and order them within it. Lanes, the move menus and agents follow what is saved here;
 * charts keep counting by kind.
 */
export function WorkflowEditor({ slug, stages, canEdit }: { slug: string; stages: readonly Stage[]; canEdit: boolean }) {
  const initial = stages.map((stage) => ({ ...stage, id: stage.key }));
  const [drafts, setDrafts] = useState<Draft[]>(initial);
  const problem = workflowProblem(drafts.map((draft) => ({ ...draft, key: draft.key ?? `new-${draft.id}` })));
  const dirty = JSON.stringify(drafts) !== JSON.stringify(initial);

  const update = (id: string, change: Partial<Draft>) => setDrafts((current) => current.map((draft) => (draft.id === id ? { ...draft, ...change } : draft)));
  const move = (id: string, by: -1 | 1) =>
    setDrafts((current) => {
      const index = current.findIndex((draft) => draft.id === id);
      const swap = index + by;
      if (swap < 0 || swap >= current.length || current[swap]!.kind !== current[index]!.kind) return current;
      const next = [...current];
      [next[index], next[swap]] = [next[swap]!, next[index]!];
      return next;
    });
  const add = (kind: Station) =>
    setDrafts((current) => {
      const last = current.map((draft) => draft.kind).lastIndexOf(kind);
      const draft: Draft = { id: `added-${++added}`, label: "", kind, hidden: false };
      return [...current.slice(0, last + 1), draft, ...current.slice(last + 1)];
    });

  const payload = JSON.stringify(drafts.map(({ key, label, kind, hidden }) => ({ ...(key && { key }), label: label.trim(), kind, hidden })));

  return (
    <ActionForm action={saveWorkflowAction} workspace={slug} notice="Saved the board's stages" className="space-y-6">
      <input type="hidden" name="stages" value={payload} />
      {LANE_ORDER.map((kind) => {
        const rows = drafts.filter((draft) => draft.kind === kind);
        return (
          <fieldset key={kind} data-kind={kind} className="space-y-2">
            <legend className="flex w-full items-center gap-2">
              <span aria-hidden className={cx("size-2.5 rounded-xs", STATION_STYLE[kind].fill)} />
              <span className="text-sm font-semibold text-ink">{TASK_STATUS_META[kind].label}</span>
              <span className="text-xs text-muted">{KIND_HINTS[kind]}</span>
            </legend>
            <ul className="space-y-2">
              {rows.map((draft, index) => {
                const builtIn = draft.key !== undefined && isBuiltIn({ key: draft.key, kind });
                const name = draft.label.trim() || "this stage";
                return (
                  <li key={draft.id} data-stage-row={draft.key ?? "new"} className="flex flex-wrap items-center gap-2 rounded-md border border-rule bg-panel px-3 py-2">
                    <div className="min-w-40 flex-1">
                      <Input
                        aria-label={builtIn ? `Name of the ${TASK_STATUS_META[kind].label} stage` : "Stage name"}
                        value={draft.label}
                        maxLength={LIMITS.stageLabel}
                        required
                        disabled={!canEdit}
                        placeholder="Stage name"
                        autoFocus={!draft.key}
                        onChange={(event) => update(draft.id, { label: event.target.value })}
                      />
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                      <input
                        type="checkbox"
                        checked={!draft.hidden}
                        disabled={!canEdit}
                        onChange={(event) => update(draft.id, { hidden: !event.target.checked })}
                        className="size-4 accent-accent"
                      />
                      On the board
                    </label>
                    {canEdit && (
                      <div className="flex items-center">
                        <Button size="sm" variant="ghost" className="px-2" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(draft.id, -1)}>
                          <ChevronUp aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" className="px-2" aria-label={`Move ${name} down`} disabled={index === rows.length - 1} onClick={() => move(draft.id, 1)}>
                          <ChevronDown aria-hidden />
                        </Button>
                        {builtIn ? (
                          <span className="w-8" aria-hidden />
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="px-2"
                            aria-label={`Remove ${name}`}
                            onClick={() => setDrafts((current) => current.filter((candidate) => candidate.id !== draft.id))}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {canEdit && drafts.length < MAX_STAGES && (
              <Button size="sm" variant="ghost" onClick={() => add(kind)}>
                <Plus aria-hidden />
                Add a stage to {TASK_STATUS_META[kind].label}
              </Button>
            )}
          </fieldset>
        );
      })}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
          <SubmitButton variant="primary" disabled={!dirty || problem !== null}>
            Save stages
          </SubmitButton>
          <Button variant="ghost" disabled={!dirty} onClick={() => setDrafts(initial)}>
            Discard changes
          </Button>
          {problem && dirty && (
            <p role="alert" className="text-xs font-semibold text-late-ink">
              {problem}
            </p>
          )}
        </div>
      )}
    </ActionForm>
  );
}
