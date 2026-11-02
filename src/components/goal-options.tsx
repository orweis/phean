export interface GoalOption {
  id: string;
  title: string;
  depth: number;
}

/** `<option>`s for a goal picker, indented to mirror the hierarchy (goals arrive depth-first). */
export function GoalOptions({ goals }: { goals: readonly GoalOption[] }) {
  return goals.map((goal) => (
    <option key={goal.id} value={goal.id}>
      {"\u00a0\u00a0".repeat(goal.depth)}
      {goal.title}
    </option>
  ));
}
