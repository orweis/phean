import { Plus } from "lucide-react";

import { createGoalAction, updateGoalAction } from "@/app/w/[slug]/actions";
import { GOAL_MAX_DEPTH, LIMITS } from "@/lib/domain";
import { subtreeIds } from "@/lib/goal-tree";
import type { Goal, GoalWithProgress } from "@/server/domain/goals";

import { GoalField } from "./goal-options";
import { ActionForm } from "./ui/action-form";
import { Field, Input, Textarea } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

/**
 * Goals that can take another level of children. A goal cannot move under itself or its own
 * sub-goals; its current parent stays listed so saving other edits never moves it.
 */
function parentChoices(goals: readonly GoalWithProgress[], moving?: Goal): GoalWithProgress[] {
  const blocked = new Set(moving ? subtreeIds(goals, moving.id) : []);
  return goals.filter(
    (goal) => goal.id === moving?.parentId || (!blocked.has(goal.id) && goal.depth < GOAL_MAX_DEPTH - 1 && goal.status !== "abandoned"),
  );
}

export function NewGoalForm({ slug, goals, parentGoalId }: { slug: string; goals: readonly GoalWithProgress[]; parentGoalId?: string }) {
  return (
    <ActionForm action={createGoalAction} workspace={slug} className="space-y-3">
      <Field label="Title" htmlFor="new-goal-title">
        <Input id="new-goal-title" name="title" required maxLength={LIMITS.title} placeholder="Close Q3 books" />
      </Field>
      <Field label="Description" htmlFor="new-goal-description">
        <Textarea id="new-goal-description" name="description" maxLength={LIMITS.text} placeholder="What does done look like?" />
      </Field>
      <GoalField
        id="new-goal-parent"
        name="parentGoalId"
        label="Part of"
        none="Top-level goal"
        goals={parentChoices(goals)}
        value={parentGoalId}
        locked={Boolean(parentGoalId)}
      />
      <SubmitButton variant="primary">
        <Plus aria-hidden />
        {parentGoalId ? "Add sub-goal" : "Create goal"}
      </SubmitButton>
    </ActionForm>
  );
}

export function EditGoalForm({ slug, goal, goals }: { slug: string; goal: Goal; goals: readonly GoalWithProgress[] }) {
  return (
    <ActionForm action={updateGoalAction} workspace={slug} className="space-y-3">
      <input type="hidden" name="goalId" value={goal.id} />
      <Field label="Title" htmlFor="edit-goal-title">
        <Input id="edit-goal-title" name="title" required maxLength={LIMITS.title} defaultValue={goal.title} />
      </Field>
      <Field label="Description" htmlFor="edit-goal-description">
        <Textarea id="edit-goal-description" name="description" maxLength={LIMITS.text} defaultValue={goal.description} />
      </Field>
      <GoalField id="edit-goal-parent" name="parentGoalId" label="Part of" none="Top-level goal" goals={parentChoices(goals, goal)} value={goal.parentId} />
      <SubmitButton>Save changes</SubmitButton>
    </ActionForm>
  );
}
