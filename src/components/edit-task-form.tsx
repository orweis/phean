import { Pencil } from "lucide-react";

import { updateTaskAction } from "@/app/w/[slug]/actions";
import { LIMITS, PRIORITIES, PRIORITY_META } from "@/lib/domain";
import type { GoalOption } from "./goal-options";
import type { TaskView } from "@/server/domain/tasks";

import { GoalField } from "./goal-options";
import { ActionForm } from "./ui/action-form";
import { DateInput } from "./ui/date-input";
import { enumOptions, Field, Input, Select, Textarea } from "./ui/field";
import { Popover, PopoverCancel } from "./ui/popover";
import { SubmitButton } from "./ui/submit-button";

/**
 * Edits a task's fields in place. Status moves stay with the card's buttons and drag and drop, so
 * this panel never changes where a task stands. Without goals to choose from, the goal is kept.
 */
export function EditTaskPopover({ task, slug, goals }: { task: TaskView; slug: string; goals: readonly GoalOption[] }) {
  const id = (field: string) => `edit-${task.id}-${field}`;
  return (
    <Popover label="Edit" icon={<Pencil aria-hidden />} look="link" align="left" title="Edit task" triggerLabel={`Edit ${task.title}`}>
      <ActionForm action={updateTaskAction} workspace={slug} className="space-y-3" notice={`Saved “${task.title}”`} closeOnSuccess>
        <input type="hidden" name="taskId" value={task.id} />
        <Field label="Title" htmlFor={id("title")}>
          <Input id={id("title")} name="title" required maxLength={LIMITS.title} defaultValue={task.title} />
        </Field>
        <Field label="Notes" htmlFor={id("description")}>
          <Textarea id={id("description")} name="description" maxLength={LIMITS.text} defaultValue={task.description} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority" htmlFor={id("priority")}>
            <Select id={id("priority")} name="priority" defaultValue={task.priority}>
              {enumOptions(PRIORITIES, PRIORITY_META)}
            </Select>
          </Field>
          <Field label="Due date" htmlFor={id("due")}>
            <DateInput id={id("due")} name="dueDate" defaultValue={task.dueDate} empty="No due date" />
          </Field>
        </div>
        <GoalField id={id("goal")} name="goalId" label="Goal" none="No goal" goals={goals} value={task.goalId} />
        <Field label="Tags" htmlFor={id("tags")} hint="Separate tags with commas.">
          <Input id={id("tags")} name="tags" maxLength={LIMITS.tag * 20} defaultValue={task.tags.join(", ")} />
        </Field>
        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="primary">
            Save changes
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}
