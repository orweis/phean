import { Plus } from "lucide-react";

import type { GoalWithProgress } from "@/server/domain/goals";

import { AddTaskForm } from "./add-task-form";
import { NewGoalForm } from "./goal-forms";
import { Popover } from "./ui/popover";

const KINDS = [
  { value: "task", label: "Task" },
  { value: "goal", label: "Goal" },
] as const;

const SWITCH_OPTION =
  "relative flex-1 cursor-pointer rounded-sm px-2.5 py-1.5 text-center text-xs font-semibold text-ink-2 transition-colors duration-(--dur-micro) " +
  "hover:bg-sunken hover:text-ink has-checked:bg-shell has-checked:text-shell-ink " +
  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus";

interface ManualEntryProps {
  slug: string;
  goals: readonly GoalWithProgress[];
  /** Pre-selects the goal a new task is filed under, such as the board's goal filter. */
  goalId?: string;
  canAddTask: boolean;
  canAddGoal: boolean;
}

/**
 * How a person adds a task or goal by hand. Agents are meant to fill the ledger, so this stays a
 * ghost button that never competes with the page's own actions. The Task/Goal switch is a pair of
 * radios read by `:has()`, so it works without client JavaScript; the radios share one name, so
 * render this once per page.
 */
export function ManualEntry({ slug, goals, goalId, canAddTask, canAddGoal }: ManualEntryProps) {
  if (!canAddTask && !canAddGoal) return null;
  const both = canAddTask && canAddGoal;
  return (
    <Popover
      variant="ghost"
      className="sm:w-96"
      label={
        <>
          <Plus aria-hidden />
          Add manually
        </>
      }
    >
      <div className="group/entry">
        <p className="text-xs text-muted">Agents capture most work for you. Add what they cannot see.</p>
        {both && (
          <fieldset className="mt-3 flex rounded-md border border-rule bg-panel p-0.5">
            <legend className="sr-only">What to add</legend>
            {KINDS.map(({ value, label }) => (
              <label key={value} className={SWITCH_OPTION}>
                <input type="radio" name="manual-entry-kind" value={value} data-kind={value} defaultChecked={value === "task"} className="sr-only" />
                {label}
              </label>
            ))}
          </fieldset>
        )}
        <div className="mt-4">
          {canAddTask && (
            <div className={both ? "group-has-[[data-kind=goal]:checked]/entry:hidden" : undefined}>
              <AddTaskForm slug={slug} goals={goals} goalId={goalId} />
            </div>
          )}
          {canAddGoal && (
            <div className={both ? "hidden group-has-[[data-kind=goal]:checked]/entry:block" : undefined}>
              <NewGoalForm slug={slug} goals={goals} />
            </div>
          )}
        </div>
      </div>
    </Popover>
  );
}
