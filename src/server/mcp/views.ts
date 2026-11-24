import { GOAL_STATUS_META, TASK_STATUS_META } from "@/lib/domain";
import { truncate } from "@/lib/format";
import { toTree, type TreeNode } from "@/lib/goal-tree";
import type { PipelineDefinition } from "@/lib/pipelines";

import type { GoalWithProgress } from "../domain/goals";
import type { Board } from "../domain/overview";
import type { TaskView } from "../domain/tasks";

/** Mermaid labels: one line, no characters that end a label or a gantt field. */
function label(text: string, max = 60): string {
  return truncate(text.replace(/["[\]{}()<>:;#|`]/g, " "), max);
}

const KANBAN_COLUMN_LIMIT = 15;

export function goalTreeMermaid(goals: readonly GoalWithProgress[], tasks: readonly TaskView[] = []): string {
  const lines = ["flowchart TD"];
  if (goals.length === 0) return [...lines, '  empty["No goals yet"]'].join("\n");

  const visit = (node: TreeNode<GoalWithProgress>) => {
    const goal = node.item;
    const counts = goal.rollup.total ? ` · ${goal.rollup.done}/${goal.rollup.total} done` : "";
    lines.push(`  ${goal.id}["${label(goal.title)}<br/>${GOAL_STATUS_META[goal.status].label}${counts}"]`);
    for (const child of node.children) {
      visit(child);
      lines.push(`  ${goal.id} --> ${child.item.id}`);
    }
  };
  toTree(goals).forEach(visit);

  const goalIds = new Set(goals.map((goal) => goal.id));
  for (const task of tasks) {
    if (!task.goalId || !goalIds.has(task.goalId)) continue;
    lines.push(`  ${task.id}(["${label(task.title, 50)} · ${TASK_STATUS_META[task.status].label}"])`);
    lines.push(`  ${task.goalId} -.- ${task.id}`);
  }

  for (const status of ["proposed", "achieved", "abandoned"] as const) {
    const ids = goals.filter((goal) => goal.status === status).map((goal) => goal.id);
    if (ids.length) lines.push(`  class ${ids.join(",")} ${status}`);
  }
  lines.push(
    "  classDef proposed stroke-dasharray: 5 5",
    "  classDef achieved fill:#dcfce7,stroke:#16a34a",
    "  classDef abandoned fill:#f4f4f5,color:#71717a",
  );
  return lines.join("\n");
}

export function kanbanMermaid(board: Board): string {
  const lines = ["kanban"];
  for (const { stage, tasks } of board.columns) {
    // Mermaid ids are words; an added stage's key may hold dashes.
    const status = stage.key.replace(/-/g, "_");
    lines.push(`  ${status}[${label(stage.label, 40)}]`);
    for (const task of tasks.slice(0, KANBAN_COLUMN_LIMIT)) {
      const owner = task.claimedByName ? ` · ${label(task.claimedByName, 20)}` : "";
      lines.push(`    ${task.id}[${label(task.title, 40)}${owner}]`);
    }
    const hidden = tasks.length - KANBAN_COLUMN_LIMIT;
    if (hidden > 0) lines.push(`    ${status}_more[+${hidden} more]`);
  }
  return lines.join("\n");
}

export function timelineMermaid(tasks: readonly TaskView[]): string {
  const lines = ["gantt", "  title Due dates", "  dateFormat YYYY-MM-DD"];
  const dated = tasks.filter((task) => task.dueDate);
  if (dated.length === 0) return [...lines, "  section Nothing scheduled", "  No due dates yet :milestone, 2000-01-01, 0d"].join("\n");

  const sections = Map.groupBy(dated, (task) => task.goalTitle ?? "No goal");
  for (const [section, sectionTasks] of sections) {
    lines.push(`  section ${label(section, 40)}`);
    for (const task of sectionTasks) {
      const tags = [task.status === "done" ? "done" : task.status === "in_progress" ? "active" : null, task.priority === "urgent" ? "crit" : null];
      const prefix = tags.filter(Boolean).join(", ");
      lines.push(`  ${label(task.title, 40)} :${prefix ? `${prefix}, ` : ""}${task.id}, ${task.dueDate}, 1d`);
    }
  }
  return lines.join("\n");
}

export function fenced(mermaid: string): string {
  return `\`\`\`mermaid\n${mermaid}\n\`\`\``;
}

/**
 * A pipeline as a left-to-right map: stops as boxes (a person's as a rounded box, with its kind and
 * who serves it), ends as circles, forks and choices as their edges (a choice's labelled), and, given
 * a run's stops, each stop's state for that run.
 */
export function pipelineMermaid(definition: PipelineDefinition, states?: ReadonlyMap<string, string>): string {
  const lines = ["flowchart LR"];
  const node = (id: string) => `s_${id}`;
  const end = (id: string) => `e_${id}`;
  for (const stop of definition.stops) {
    const who = stop.kind === "agent" ? stop.agent! : stop.kind === "person" ? (stop.person ?? `any ${stop.role}`) : "any agent";
    const state = states?.get(stop.id);
    const text = `${label(stop.name, 40)}<br/>${label(who, 30)}${state ? ` · ${label(state, 20)}` : ""}`;
    lines.push(stop.kind === "person" ? `  ${node(stop.id)}("${text}")` : `  ${node(stop.id)}["${text}"]`);
  }
  for (const finish of definition.ends) lines.push(`  ${end(finish.id)}(("${label(finish.name, 30)}"))`);
  for (const stop of definition.stops) {
    const { then } = stop;
    if (then.next) lines.push(`  ${node(stop.id)} --> ${node(then.next)}`);
    for (const target of then.fork ?? []) lines.push(`  ${node(stop.id)} --> ${node(target)}`);
    for (const branch of then.choice ?? []) lines.push(`  ${node(stop.id)} -- "${label(branch.label, 30)}" --> ${branch.to ? node(branch.to) : end(branch.end!)}`);
    if (then.end) lines.push(`  ${node(stop.id)} --> ${end(then.end)}`);
  }
  return lines.join("\n");
}
