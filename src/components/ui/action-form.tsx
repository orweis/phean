"use client";

import { useActionState, type ReactNode } from "react";

import { IDLE, type ActionState } from "@/lib/action-state";
import { cx } from "@/lib/cx";
import { sendTracked, type Tracked, type TrackedEvents } from "@/lib/tracked";

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
  /**
   * The analytics event to send once the action succeeds (never on a click that fails). Params the
   * server decides (`decision_answer`'s `first_answer`) come back in the result's `data.analytics`
   * and are added to it; `track` drops any the catalog does not allow. A client component may pass
   * a function of the result instead. See docs/ANALYTICS.md.
   */
  analytics?: TrackedEvents | ((result: ActionState) => TrackedEvents | null | undefined);
}

/** Static events with the params the server action handed back in `data.analytics` added to each. */
function withServerParams(analytics: TrackedEvents | undefined, result: ActionState): TrackedEvents | undefined {
  const extra = result.data?.analytics;
  if (!analytics || !extra || typeof extra !== "object") return analytics;
  const add = (one: Tracked) => ({ ...one, params: { ...one.params, ...extra } }) as Tracked;
  return Array.isArray(analytics) ? (analytics as readonly Tracked[]).map(add) : add(analytics as Tracked);
}

export function ActionForm({ action, workspace, confirm, children, className, quiet = false, notice, undo, closeOnSuccess = false, exits = false, analytics }: ActionFormProps) {
  const status = useStatus();
  const popover = usePopover();
  const announced = Boolean(status && (notice || undo || closeOnSuccess));

  // The row this form sits in may be gone by the time the result renders, so the notice is sent
  // from the action itself, not from an effect of this (possibly unmounted) form.
  const run = async (previous: ActionState, formData: FormData): Promise<ActionState> => {
    const result = await action(previous, formData);
    if (result.status === "success") {
      sendTracked(typeof analytics === "function" ? analytics(result) : withServerParams(analytics, result));
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
