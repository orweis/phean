import { Plus } from "lucide-react";

import { addTaskAction } from "@/app/w/[slug]/actions";
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
  return (
    <ActionForm action={addTaskAction} workspace={slug}>
      <input type="hidden" name="status" value="todo" />
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="add-task-title">
          Task
        </label>
        <Input id="add-task-title" name="title" required maxLength={200} placeholder="Add a task…" className="min-w-56 flex-[2]" />
        <label className="sr-only" htmlFor="add-task-priority">
          Priority
        </label>
        <Select id="add-task-priority" name="priority" defaultValue="medium" className="w-28">
          {enumOptions(PRIORITIES, PRIORITY_META)}
        </Select>
        <label className="sr-only" htmlFor="add-task-due">
          Due date
        </label>
        <Input id="add-task-due" name="dueDate" type="date" className="w-40" />
        {lockGoal && goalId ? (
          <input type="hidden" name="goalId" value={goalId} />
        ) : (
          <>
            <label className="sr-only" htmlFor="add-task-goal">
              Goal
            </label>
            <Select id="add-task-goal" name="goalId" defaultValue={goalId ?? ""} className="w-48 flex-1">
              <option value="">No goal</option>
              <GoalOptions goals={goals} />
            </Select>
          </>
        )}
        <SubmitButton variant="primary">
          <Plus aria-hidden />
          Add
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
