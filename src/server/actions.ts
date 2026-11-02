import "server-only";

import { isAPIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";

import type { ActionState } from "@/lib/action-state";
import { routes } from "@/lib/routes";

import { requireWorkspace } from "./auth/session";
import type { Ctx } from "./domain/context";
import { isDomainError } from "./domain/errors";
import { parseInput } from "./domain/service";
import { formToInput } from "./forms";

/** A user-facing message for expected failures; anything else propagates to the error boundary. */
export function expectedErrorMessage(error: unknown): string | null {
  if (isDomainError(error)) return error.message;
  if (isAPIError(error)) return error.body?.message ?? error.message;
  return null;
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; state: ActionState };

/** Runs `fn`, turning expected failures into a form error state; anything else (including redirects) is rethrown. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    const message = expectedErrorMessage(error);
    if (message === null) throw error;
    return { ok: false, state: { status: "error", message, at: Date.now() } };
  }
}

interface TenantActionOptions<O> {
  success?: string | ((output: O) => string);
  /** Values handed back to the form, e.g. a token that is shown exactly once. */
  data?: (output: O) => Record<string, unknown>;
  redirectTo?: (output: O, ctx: Ctx) => string;
}

/**
 * Wraps a workspace-scoped mutation as a `useActionState` server action. The form posts a
 * `workspace` slug; the wrapper resolves it against the session (never trusting the slug alone),
 * validates the fields with the service's schema, and refreshes every page of that workspace.
 */
export function tenantAction<S extends z.ZodObject, O>(
  schema: S,
  run: (ctx: Ctx, input: z.output<S>) => Promise<O>,
  options: TenantActionOptions<O> = {},
) {
  return async (_previous: ActionState, formData: FormData): Promise<ActionState> => {
    const slug = String(formData.get("workspace") ?? "");
    const { ctx } = await requireWorkspace(slug);

    const result = await attempt(() => run(ctx, parseInput(schema, formToInput(formData, schema))));
    if (!result.ok) return result.state;
    const output = result.value;

    revalidatePath(routes.workspace(slug), "layout");
    if (options.redirectTo) redirect(options.redirectTo(output, ctx));
    const message = typeof options.success === "function" ? options.success(output) : options.success;
    return { status: "success", message, data: options.data?.(output), at: Date.now() };
  };
}
