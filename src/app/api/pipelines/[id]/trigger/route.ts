import { pipelineTrigger } from "@/server/entry";

/**
 * A regular pipeline's inbound webhook: POST with its secret starts a run. Rate limited per client
 * and pipeline; the secret, checked against the pipeline's stored hash, is the only credential.
 */
export async function POST(request: Request, context: RouteContext<"/api/pipelines/[id]/trigger">): Promise<Response> {
  const { id } = await context.params;
  return pipelineTrigger(request, id);
}
