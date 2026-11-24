import type { ComponentProps } from "react";

import type { ActionState } from "@/lib/action-state";
import type { TrackedEvents } from "@/lib/tracked";

import { ActionForm, type FormAction } from "./action-form";
import type { UndoSpec } from "./status-region";
import { SubmitButton } from "./submit-button";

interface ActionButtonProps extends ComponentProps<typeof SubmitButton> {
  action: FormAction;
  /** Slug of the workspace the action applies to; the server re-checks access. */
  workspace?: string;
  /** The action's input, posted as hidden fields. */
  fields: Record<string, string>;
  /** Asks for confirmation first, for actions that are rare and hard to undo. */
  confirm?: string;
  /** What the status region says once it worked, naming the object. */
  notice?: string;
  /** The reverse transition, offered as Undo beside the notice. */
  undo?: UndoSpec;
  /** The click takes the button's row off the screen (Done, Drop), so the row fades while it runs. */
  exits?: boolean;
  /** Close the menu or panel the button sits in once it worked. */
  closeOnSuccess?: boolean;
  /** The analytics event(s) to send once the action succeeds (see `ActionForm`). From a server component, an object, not a function. */
  analytics?: TrackedEvents | ((result: ActionState) => TrackedEvents | null | undefined);
}

/**
 * A one-click action: a button that posts fixed fields. Its result shows in the page itself
 * (a card moves, a row goes) and, with a `notice`, in the workspace's status region with Undo;
 * failures are reported next to it.
 */
export function ActionButton({ action, workspace, fields, confirm, notice, undo, exits, closeOnSuccess, analytics, ...button }: ActionButtonProps) {
  return (
    <ActionForm action={action} workspace={workspace} confirm={confirm} notice={notice} undo={undo} exits={exits} closeOnSuccess={closeOnSuccess} analytics={analytics} quiet>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton {...button} />
    </ActionForm>
  );
}
