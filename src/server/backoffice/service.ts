import { z } from "zod";

import { parseInput } from "../domain/service";
import { recordAudit } from "./audit";
import { assertPlatformAdmin, type PlatformCtx } from "./context";

/** What an audit row says a call was about, read from the parsed input and the result. */
interface AuditOptions<I, O> {
  tenantId?: (input: I, output: O) => string | undefined;
  subjectUserId?: (input: I, output: O) => string | undefined;
  reason?: (input: I, output: O) => string | undefined;
}

export type PlatformServiceFn<S extends z.ZodType, O> = ((ctx: PlatformCtx, input: z.input<S>) => Promise<O>) & {
  readonly schema: S;
  /** The audit action every call records, e.g. `view.overview`. */
  readonly action: string;
};

/**
 * Declares a backoffice read. It validates its input, checks the caller is a platform admin now
 * (`assertPlatformAdmin`), runs, and records the call in `backoffice_audit` with its parsed input as
 * the filters, so every page view and export that showed something leaves a row (a call that fails,
 * a missing workspace say, showed nothing and records nothing). Backoffice services read across tenants
 * and so never use `inTenant`; they never write tenant tables.
 */
export function platformService<S extends z.ZodType, O>(
  action: string,
  schema: S,
  run: (ctx: PlatformCtx, input: z.output<S>) => Promise<O>,
  audit: AuditOptions<z.output<S>, O> = {},
): PlatformServiceFn<S, O> {
  const fn = async (ctx: PlatformCtx, input: z.input<S>) => {
    const parsed = parseInput(schema, input);
    await assertPlatformAdmin(ctx);
    const output = await run(ctx, parsed);
    await recordAudit(ctx, {
      action,
      filters: (parsed ?? {}) as Record<string, unknown>,
      tenantId: audit.tenantId?.(parsed, output),
      subjectUserId: audit.subjectUserId?.(parsed, output),
      reason: audit.reason?.(parsed, output),
    });
    return output;
  };
  return Object.assign(fn, { schema, action });
}
