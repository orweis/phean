"use client";

import { useActionState, type ReactNode } from "react";

import { IDLE, type ActionState } from "@/lib/action-state";
import { cx } from "@/lib/cx";

import { usePopover } from "./popover";
import { useStatus, type UndoSpec } from "./status-region";

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

interface ActionFormProps {
  action: FormAction;
  /** Slug of the workspace the action applies to; the server re-checks access. */
  workspace?: string;
  /** Asks for confirmation first, for actions that are rare and hard to undo. */
  confirm?: string;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  /** Hide success messages for actions whose result is visible anyway (e.g. moving a card). */
  quiet?: boolean;
  /**
   * What the workspace's status region says on success, naming the object ("Dropped 'Read the
   * thread'"). Without a status region (outside a workspace) the form reports inline as usual.
   */
  notice?: string;
  /** The reverse transition, offered as Undo beside the notice. */
  undo?: UndoSpec;
  /** Close the panel the form sits in once it succeeds; the result goes to the status region. */
  closeOnSuccess?: boolean;
  /**
   * Marks a form whose success takes its row off the screen (Done, Drop), so the row can fade
   * with `has-[[data-exit][data-pending]]` while the server renders the change.
   */
  exits?: boolean;
}

export function ActionForm({ action, workspace, confirm, children, className, quiet = false, notice, undo, closeOnSuccess = false, exits = false }: ActionFormProps) {
  const status = useStatus();
  const popover = usePopover();
  const announced = Boolean(status && (notice || undo || closeOnSuccess));

  // The row this form sits in may be gone by the time the result renders, so the notice is sent
  // from the action itself, not from an effect of this (possibly unmounted) form.
  const run = async (previous: ActionState, formData: FormData): Promise<ActionState> => {
    const result = await action(previous, formData);
    if (result.status === "success") {
      if (announced) status!.announce({ message: notice ?? result.message ?? "Saved.", undo, workspace });
      if (closeOnSuccess) popover?.close();
    }
    return result;
  };
  const [state, formAction, pending] = useActionState(run, IDLE);
  const showMessage = state.message && (state.status === "error" || (!quiet && !announced));

  return (
    <form
      action={formAction}
      className={className}
      data-pending={pending || undefined}
      data-exit={exits || undefined}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {workspace && <input type="hidden" name="workspace" value={workspace} />}
      {typeof children === "function" ? children(state) : children}
      {showMessage && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={cx("mt-2 text-xs font-semibold", state.status === "error" ? "text-late-ink" : "text-arrive-ink")}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
