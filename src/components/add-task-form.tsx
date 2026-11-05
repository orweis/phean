import { Plus } from "lucide-react";

import { addTaskAction } from "@/app/w/[slug]/actions";
import { LIMITS, PRIORITIES, PRIORITY_META } from "@/lib/domain";
import type { GoalWithProgress } from "@/server/domain/goals";

import { GoalField } from "./goal-options";
import { ActionForm } from "./ui/action-form";
import { DateInput } from "./ui/date-input";
import { enumOptions, Field, Input, Select, Textarea } from "./ui/field";
import { PopoverCancel } from "./ui/popover";
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
        <Input id="add-task-title" name="title" required maxLength={LIMITS.title} placeholder="Renew the parking permits" />
      </Field>
      <Field label="Notes" htmlFor="add-task-description">
        <Textarea id="add-task-description" name="description" maxLength={LIMITS.text} placeholder="Optional" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority" htmlFor="add-task-priority">
          <Select id="add-task-priority" name="priority" defaultValue="medium">
            {enumOptions(PRIORITIES, PRIORITY_META)}
          </Select>
        </Field>
        <Field label="Due date" htmlFor="add-task-due">
          <DateInput id="add-task-due" name="dueDate" empty="No due date" />
        </Field>
      </div>
      <GoalField id="add-task-goal" name="goalId" label="Goal" none="No goal" goals={openGoals} value={goalId} locked={lockGoal} />
      <div className="flex items-center gap-2">
        <SubmitButton variant="primary">
          <Plus aria-hidden />
          Add task
        </SubmitButton>
        <PopoverCancel />
      </div>
    </ActionForm>
  );
}
