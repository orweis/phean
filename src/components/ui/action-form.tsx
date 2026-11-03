"use client";

import { useActionState, type ReactNode } from "react";

import { IDLE, type ActionState } from "@/lib/action-state";
import { cx } from "@/lib/cx";

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

interface ActionFormProps {
  action: FormAction;
  /** Slug of the workspace the action applies to; the server re-checks access. */
  workspace?: string;
  /** Asks for confirmation first, for actions that are hard to undo. */
  confirm?: string;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  /** Hide success messages for actions whose result is visible anyway (e.g. moving a card). */
  quiet?: boolean;
}

export function ActionForm({ action, workspace, confirm, children, className, quiet = false }: ActionFormProps) {
  const [state, formAction] = useActionState(action, IDLE);
  const showMessage = state.message && (state.status === "error" || !quiet);

  return (
    <form
      action={formAction}
      className={className}
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
