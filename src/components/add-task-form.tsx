import { Plus } from "lucide-react";

import { addTaskAction } from "@/app/w/[slug]/actions";
import { PRIORITIES, PRIORITY_META } from "@/lib/domain";
import type { GoalWithProgress } from "@/server/domain/goals";

import { GoalOptions } from "./goal-options";
import { ActionForm } from "./ui/action-form";
import { enumOptions, Field, Input, Select, Textarea } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

interface AddTaskFormProps {
  slug: string;
  goals: readonly GoalWithProgress[];
  /** Pre-selects (or, with `lockGoal`, fixes) the goal new tasks are filed under. */
  goalId?: string;
  lockGoal?: boolean;
}

/** Tasks people add are already triaged, so they skip the inbox. */
export function AddTaskForm({ slug, goals, goalId, lockGoal = false }: AddTaskFormProps) {
  const openGoals = goals.filter((goal) => goal.status === "active" || goal.status === "proposed");
  return (
    <ActionForm action={addTaskAction} workspace={slug} className="space-y-3">
      <input type="hidden" name="status" value="todo" />
      <Field label="Task" htmlFor="add-task-title">
        <Input id="add-task-title" name="title" required maxLength={200} placeholder="Renew the parking permits" />
      </Field>
      <Field label="Notes" htmlFor="add-task-description">
        <Textarea id="add-task-description" name="description" maxLength={5000} placeholder="Optional" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority" htmlFor="add-task-priority">
          <Select id="add-task-priority" name="priority" defaultValue="medium">
            {enumOptions(PRIORITIES, PRIORITY_META)}
          </Select>
        </Field>
        <Field label="Due date" htmlFor="add-task-due">
          <Input id="add-task-due" name="dueDate" type="date" />
        </Field>
      </div>
      {lockGoal && goalId ? (
        <input type="hidden" name="goalId" value={goalId} />
      ) : (
        <Field label="Goal" htmlFor="add-task-goal">
          <Select id="add-task-goal" name="goalId" defaultValue={goalId ?? ""}>
            <option value="">No goal</option>
            <GoalOptions goals={openGoals} />
          </Select>
        </Field>
      )}
      <SubmitButton variant="primary">
        <Plus aria-hidden />
        Add task
      </SubmitButton>
    </ActionForm>
  );
}
