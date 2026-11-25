import { createHash, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "../db/client";
import { organization, pipelineTriggers } from "../db/schema";
import { isDomainError } from "../domain/errors";
import { beginRun, systemContext } from "../domain/pipeline-engine";
import { RunOptionsInput } from "../domain/schemas";
import { parseInput } from "../domain/service";
import { clientAddressOf, withinRateLimit } from "../rate-limit";

export { withinRateLimit };

/** Calls one client may make to one pipeline's trigger in a window, like the other public endpoints. */
export const PIPELINE_TRIGGER_LIMIT = { window: 60, max: 30 };
/** The largest body the trigger reads. */
export const PIPELINE_TRIGGER_MAX_BYTES = 32 * 1024;
/** The header that carries the secret, for callers that cannot set Authorization. */
export const PIPELINE_SECRET_HEADER = "phean-pipeline-secret";

const TriggerBody = z.object({ inputs: RunOptionsInput.shape.inputs, name: RunOptionsInput.shape.name });

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function clientAddress(request: Request): string {
  return clientAddressOf(request.headers);
}

function secretOf(request: Request): string | null {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  return bearer ?? request.headers.get(PIPELINE_SECRET_HEADER);
}

/** Whether `secret` is the pipeline webhook's, compared in constant time on its hash. */
function matches(secret: string, storedHash: string): boolean {
  const given = createHash("sha256").update(secret).digest();
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/**
 * `POST /api/pipelines/<id>/trigger`: starts a run of a regular pipeline whose webhook is on, with
 * the secret shown when it was turned on (`Authorization: Bearer <secret>`, or the
 * `Phean-Pipeline-Secret` header) and an optional JSON body `{ "name": "...", "inputs": { ... } }`. The pipeline's
 * row, never the request, decides the workspace. A wrong secret and an unknown pipeline answer alike.
 */
export async function handlePipelineTrigger(request: Request, { db, pipelineId }: { db: Db; pipelineId: string }): Promise<Response> {
  if (!(await withinRateLimit(db, `pipeline-trigger:${clientAddress(request)}:${pipelineId}`, PIPELINE_TRIGGER_LIMIT))) {
    return json(429, { error: "Too many requests. Try again in a minute." }, { "Retry-After": String(PIPELINE_TRIGGER_LIMIT.window) });
  }
  const secret = secretOf(request);
  const [trigger] = secret
    ? await db
        .select({ secretHash: pipelineTriggers.secretHash, tenant: { id: organization.id, slug: organization.slug, name: organization.name } })
        .from(pipelineTriggers)
        .innerJoin(organization, eq(organization.id, pipelineTriggers.tenantId))
        .where(and(eq(pipelineTriggers.pipelineId, pipelineId), eq(pipelineTriggers.kind, "webhook")))
    : [];
  if (!secret || !trigger?.secretHash || !matches(secret, trigger.secretHash)) return json(401, { error: "Unknown pipeline, or a wrong secret." });

  const text = await request.text();
  if (text.length > PIPELINE_TRIGGER_MAX_BYTES) return json(413, { error: `The body is over ${PIPELINE_TRIGGER_MAX_BYTES} bytes.` });
  let body: unknown = {};
  try {
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return json(400, { error: "The body must be JSON: { \"inputs\": { ... } }." });
  }
  try {
    const { inputs, name } = parseInput(TriggerBody, body);
    const run = await beginRun(systemContext(db, trigger.tenant), pipelineId, {
      trigger: "webhook",
      by: { type: "system", id: null, name: "Webhook" },
      detail: `From ${clientAddress(request)}`,
      name,
      inputs,
      strict: true,
    });
    return json(202, { runId: run.id, number: run.number, status: run.status });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    const status = { invalid: 400, not_found: 404, forbidden: 403, conflict: 409 }[error.code];
    return json(status, { error: error.message });
  }
}
