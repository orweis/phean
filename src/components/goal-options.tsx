import { Field, Select } from "./ui/field";

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

interface GoalFieldProps {
  id: string;
  name: "goalId" | "parentGoalId";
  label: string;
  /** What choosing no goal means here, e.g. "No goal" or "Top-level goal". */
  none: string;
  goals: readonly GoalOption[];
  /** The goal chosen up front. */
  value?: string | null;
  /** Posts `value` without offering a choice, for forms already under one goal. */
  locked?: boolean;
}

/** A goal picker, or the fixed goal a form files under. Without goals to choose from it renders nothing. */
export function GoalField({ id, name, label, none, goals, value, locked = false }: GoalFieldProps) {
  if (locked && value) return <input type="hidden" name={name} value={value} />;
  if (goals.length === 0) return null;
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} name={name} defaultValue={value ?? ""}>
        <option value="">{none}</option>
        <GoalOptions goals={goals} />
      </Select>
    </Field>
  );
}
