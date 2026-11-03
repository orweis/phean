import type { ComponentProps } from "react";

import { ActionForm, type FormAction } from "./action-form";
import { SubmitButton } from "./submit-button";

interface ActionButtonProps extends ComponentProps<typeof SubmitButton> {
  action: FormAction;
  /** Slug of the workspace the action applies to; the server re-checks access. */
  workspace?: string;
  /** The action's input, posted as hidden fields. */
  fields: Record<string, string>;
  /** Asks for confirmation first, for actions that are hard to undo. */
  confirm?: string;
}

/**
 * A one-click action: a button that posts fixed fields. Its result shows in the page itself
 * (a card moves, a row goes), so only failures are reported next to it.
 */
export function ActionButton({ action, workspace, fields, confirm, ...button }: ActionButtonProps) {
  return (
    <ActionForm action={action} workspace={workspace} confirm={confirm} quiet>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton {...button} />
    </ActionForm>
  );
}
