import { Plus } from "lucide-react";

import { addTaskAction } from "@/app/w/[slug]/actions";
import { cx } from "@/lib/cx";
import { PRIORITIES, PRIORITY_META } from "@/lib/domain";
import type { GoalWithProgress } from "@/server/domain/goals";

import { GoalOptions } from "./goal-options";
import { ActionForm } from "./ui/action-form";
import { enumOptions, Input, Select } from "./ui/field";
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
  const pickGoal = !(lockGoal && goalId);
  return (
    <ActionForm action={addTaskAction} workspace={slug}>
      <input type="hidden" name="status" value="todo" />
      <div
        className={cx(
          "grid gap-2 sm:items-center",
          pickGoal ? "sm:grid-cols-[minmax(0,1fr)_7rem_10rem_minmax(0,14rem)_auto]" : "sm:grid-cols-[minmax(0,1fr)_7rem_10rem_auto]",
        )}
      >
        <label className="sr-only" htmlFor="add-task-title">
          Task
        </label>
        <Input id="add-task-title" name="title" required maxLength={200} placeholder="Add a task…" />
        <label className="sr-only" htmlFor="add-task-priority">
          Priority
        </label>
        <Select id="add-task-priority" name="priority" defaultValue="medium">
          {enumOptions(PRIORITIES, PRIORITY_META)}
        </Select>
        <label className="sr-only" htmlFor="add-task-due">
          Due date
        </label>
        <Input id="add-task-due" name="dueDate" type="date" />
        {pickGoal ? (
          <>
            <label className="sr-only" htmlFor="add-task-goal">
              Goal
            </label>
            <Select id="add-task-goal" name="goalId" defaultValue={goalId ?? ""}>
              <option value="">No goal</option>
              <GoalOptions goals={goals} />
            </Select>
          </>
        ) : (
          <input type="hidden" name="goalId" value={goalId} />
        )}
        <SubmitButton variant="primary">
          <Plus aria-hidden />
          Add
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
