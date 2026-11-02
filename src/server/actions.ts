import "server-only";

import { isAPIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "@/lib/action-state";
import { routes } from "@/lib/routes";

import { requireWorkspace } from "./auth/session";
import type { Ctx } from "./domain/context";
import { isDomainError } from "./domain/errors";
import { parseInput } from "./domain/service";

const WRAPPERS = new Set(["optional", "default", "nullable", "prefault", "readonly", "catch"]);

function isArrayField(field: z.ZodType): boolean {
  let current: z.core.$ZodType = field;
  while (WRAPPERS.has(current._zod.def.type)) {
    current = (current._zod.def as unknown as { innerType: z.core.$ZodType }).innerType;
  }
  return current._zod.def.type === "array";
}

/**
 * Reads the fields a schema declares from a form. Empty inputs mean "not provided",
 * or "clear it" (null) for nullable fields; array fields accept repeated or comma-separated values.
 */
export function formToInput(formData: FormData, schema: z.ZodObject): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    const values = formData.getAll(key).filter((value): value is string => typeof value === "string");
    if (values.length === 0) continue;
    if (isArrayField(field)) {
      input[key] = values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
    } else if (values[0]!.trim() === "") {
      if (field.safeParse(null).success) input[key] = null;
    } else {
      input[key] = values[0];
    }
  }
  return input;
}

/** A user-facing message for expected failures; anything else propagates to the error boundary. */
export function expectedErrorMessage(error: unknown): string | null {
  if (isDomainError(error)) return error.message;
  if (isAPIError(error)) return error.body?.message ?? error.message;
  return null;
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

    let output: O;
    try {
      output = await run(ctx, parseInput(schema, formToInput(formData, schema)));
    } catch (error) {
      const message = expectedErrorMessage(error);
      if (message === null) throw error;
      return { status: "error", message, at: Date.now() };
    }

    revalidatePath(routes.workspace(slug), "layout");
    if (options.redirectTo) redirect(options.redirectTo(output, ctx));
    const message = typeof options.success === "function" ? options.success(output) : options.success;
    return { status: "success", message, data: options.data?.(output), at: Date.now() };
  };
}
