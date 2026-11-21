import { z } from "zod";

import type { Ctx, PersonCtx } from "./context";
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

export type PersonServiceFn<S extends z.ZodType, O, Extra = never> = ((ctx: PersonCtx, input: z.input<S>, extra?: Extra) => Promise<O>) & {
  readonly schema: S;
};

/**
 * `service` for an operation on a person's own account (`PersonCtx`). `extra` is for what only the
 * adapter knows and must never come from input, such as the session the request arrived on.
 */
export function personService<S extends z.ZodType, O, Extra = never>(
  schema: S,
  run: (ctx: PersonCtx, input: z.output<S>, extra?: Extra) => Promise<O>,
): PersonServiceFn<S, O, Extra> {
  const fn = async (ctx: PersonCtx, input: z.input<S>, extra?: Extra) => run(ctx, parseInput(schema, input), extra);
  return Object.assign(fn, { schema });
}
