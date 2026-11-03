import { Plus } from "lucide-react";

import { rememberAction } from "@/app/w/[slug]/actions";
import { LIMITS, MEMORY_KIND_META, MEMORY_KINDS } from "@/lib/domain";
import type { GoalWithProgress } from "@/server/domain/goals";

import { GoalOptions } from "./goal-options";
import { ActionForm } from "./ui/action-form";
import { enumOptions, Field, Input, Select, Textarea } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

interface RememberFormProps {
  slug: string;
  goals: readonly GoalWithProgress[];
  /** Files the memory under this goal without offering a choice. */
  goalId?: string;
}

/** Workspace memory is shared: whatever a person saves here, every agent can recall. */
export function RememberForm({ slug, goals, goalId }: RememberFormProps) {
  return (
    <ActionForm action={rememberAction} workspace={slug} className="space-y-3">
      <Field label="What should agents remember?" htmlFor="remember-content">
        <Textarea
          id="remember-content"
          name="content"
          required
          maxLength={LIMITS.memory}
          placeholder="Invoices from Acme go to finance@acme.com, never to the account manager."
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind" htmlFor="remember-kind">
          <Select id="remember-kind" name="kind" defaultValue="fact">
            {enumOptions(MEMORY_KINDS, MEMORY_KIND_META)}
          </Select>
        </Field>
        <Field label="Tags" htmlFor="remember-tags" hint="Comma-separated">
          <Input id="remember-tags" name="tags" placeholder="billing, acme" />
        </Field>
      </div>
      {goalId ? (
        <input type="hidden" name="goalId" value={goalId} />
      ) : (
        goals.length > 0 && (
          <Field label="About goal" htmlFor="remember-goal">
            <Select id="remember-goal" name="goalId" defaultValue="">
              <option value="">Whole workspace</option>
              <GoalOptions goals={goals} />
            </Select>
          </Field>
        )
      )}
      <SubmitButton variant="primary">
        <Plus aria-hidden />
        Remember
      </SubmitButton>
    </ActionForm>
  );
}
