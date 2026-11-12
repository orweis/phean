/**
 * A workspace's workflow: the stages (board lanes) tasks move through. Every stage belongs to one
 * of the built-in kinds (inbox, backlog, to do, in progress, done), which charts, lateness, claims
 * and agents understand; a workspace renames or hides the built-in stage of each kind and adds its
 * own stages in between ("Review" inside In progress, "Shipped" inside Done). Stages run in
 * `LANE_ORDER`, so Backlog sits to the right of Done. Client-safe.
 */
import { isOneOf, LANE_ORDER, LIMITS, STATIONS, TASK_STATUS_META, type Station, type TaskStatus } from "./domain";

export interface Stage {
  /** Stable id: a built-in stage's key is its kind; an added stage's is a slug of its first name. */
  key: string;
  label: string;
  kind: Station;
  /** Off the board and out of the move menus; a hidden lane still shows while tasks are in it. */
  hidden: boolean;
}

export type Workflow = readonly Stage[];

/** The most stages a workspace keeps, built-in ones included. */
export const MAX_STAGES = 16;

/** Kinds whose built-in stage must stay visible, so work can always be planned, done and finished. */
export const REQUIRED_KINDS: readonly Station[] = ["todo", "in_progress", "done"];

/** An added stage's key: lowercase letters, digits and dashes, never a kind's own name. */
export const STAGE_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const isBuiltIn = (stage: Pick<Stage, "key" | "kind">) => stage.key === stage.kind;

export const DEFAULT_WORKFLOW: Workflow = LANE_ORDER.map((kind) => ({ key: kind, label: TASK_STATUS_META[kind].label, kind, hidden: false }));

/** Stages in lane order (`LANE_ORDER`): by kind, keeping the workspace's own order within each kind. */
export function inFlowOrder(stages: readonly Stage[]): Stage[] {
  const rank = (stage: Stage) => LANE_ORDER.indexOf(stage.kind);
  return stages.map((stage, index) => ({ stage, index })).sort((a, b) => rank(a.stage) - rank(b.stage) || a.index - b.index).map(({ stage }) => stage);
}

/**
 * A stored workflow made whole: every kind keeps its built-in stage (added back if missing), and
 * stages come in flow order. Anything unreadable falls back to the defaults.
 */
export function normalizeWorkflow(stored: unknown): Stage[] {
  const rows = Array.isArray(stored) ? stored : [];
  const stages: Stage[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { key, label, kind, hidden } = row as Partial<Stage>;
    if (typeof key !== "string" || typeof label !== "string" || !isOneOf(STATIONS, kind)) continue;
    if (stages.some((stage) => stage.key === key)) continue;
    stages.push({ key, label: label.slice(0, LIMITS.stageLabel) || TASK_STATUS_META[kind].label, kind, hidden: Boolean(hidden) });
  }
  for (const builtIn of DEFAULT_WORKFLOW) if (!stages.some((stage) => stage.key === builtIn.key)) stages.push(builtIn);
  return inFlowOrder(stages);
}

/** The stage a task stands in: its own, if the workflow still has it in the task's kind, else the kind's built-in stage. */
export function stageOf(workflow: Workflow, task: { status: TaskStatus; stage: string | null }): Stage | null {
  if (task.status === "dropped") return null;
  const own = task.stage ? workflow.find((stage) => stage.key === task.stage && stage.kind === task.status) : undefined;
  return own ?? workflow.find((stage) => stage.key === task.status) ?? null;
}

/** What a task's status reads as in this workspace: its stage's name, or "Dropped". */
export function stageLabel(workflow: Workflow, task: { status: TaskStatus; stage: string | null }): string {
  return stageOf(workflow, task)?.label ?? TASK_STATUS_META[task.status].label;
}

/** The stages people move tasks between: visible ones, in flow order. */
export const visibleStages = (workflow: Workflow) => workflow.filter((stage) => !stage.hidden);

/** A key for a new stage named `label`, unique within the workflow. */
export function stageKeyFor(workflow: Workflow, label: string): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/, "") || "stage";
  const taken = new Set([...workflow.map((stage) => stage.key), ...STATIONS, "dropped"]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Why a workflow cannot be saved, or null when it can: each kind keeps its built-in stage, the
 * kinds that work needs stay visible, keys are unique and well formed, labels are set, and there
 * are no more than `MAX_STAGES`.
 */
export function workflowProblem(stages: readonly Stage[]): string | null {
  if (stages.length > MAX_STAGES) return `A workspace keeps at most ${MAX_STAGES} stages.`;
  const keys = new Set<string>();
  for (const stage of stages) {
    if (keys.has(stage.key)) return `Two stages share the key "${stage.key}".`;
    keys.add(stage.key);
    if (!stage.label.trim()) return "Every stage needs a name.";
    if (stage.label.length > LIMITS.stageLabel) return `Stage names are at most ${LIMITS.stageLabel} characters.`;
    if (!isBuiltIn(stage) && (!STAGE_KEY_PATTERN.test(stage.key) || isOneOf([...STATIONS, "dropped"], stage.key))) {
      return `"${stage.key}" is not a usable stage key.`;
    }
  }
  for (const kind of STATIONS) {
    const builtIn = stages.find((stage) => stage.key === kind);
    if (!builtIn || builtIn.kind !== kind) return `The ${TASK_STATUS_META[kind].label} stage cannot be removed; hide it instead.`;
  }
  for (const kind of REQUIRED_KINDS) {
    if (!stages.some((stage) => stage.kind === kind && !stage.hidden)) return `Keep at least one ${TASK_STATUS_META[kind].label} stage visible.`;
  }
  return null;
}
