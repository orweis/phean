import { LIMITS } from "@/lib/domain";
import { requireWorkspace } from "@/server/auth/session";
import { suggest } from "@/server/domain/search";

/**
 * Search's suggestions for `?q=`, for a person signed in to the workspace (the session decides,
 * never the slug alone). An empty or over-long query has nothing to suggest.
 */
export async function GET(request: Request, context: RouteContext<"/w/[slug]/suggest">) {
  const { slug } = await context.params;
  const { ctx } = await requireWorkspace(slug);
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const suggestions = query && query.length <= LIMITS.query ? await suggest(ctx, { query }) : [];
  return Response.json({ suggestions }, { headers: { "Cache-Control": "private, no-store" } });
}
