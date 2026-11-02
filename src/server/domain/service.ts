import { z } from "zod";

import type { Ctx } from "./context";
import { invalid } from "./errors";

export type ServiceFn<S extends z.ZodType, O> = ((ctx: Ctx, input: z.input<S>) => Promise<O>) & {
  readonly schema: S;
};

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw invalid(z.prettifyError(result.error));
  return result.data;
}

/**
 * Declares a domain operation. The service validates its own input (it is the trust boundary
 * for both MCP tools and server actions) and exposes its schema so adapters can reuse it.
 */
export function service<S extends z.ZodType, O>(
  schema: S,
  run: (ctx: Ctx, input: z.output<S>) => Promise<O>,
): ServiceFn<S, O> {
  const fn = async (ctx: Ctx, input: z.input<S>) => run(ctx, parseInput(schema, input));
  return Object.assign(fn, { schema });
}
