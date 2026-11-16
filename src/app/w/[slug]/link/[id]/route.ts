import { pathOf } from "@/lib/links";

/**
 * A permalink for anything with a Phean id, so an agent can link a task, goal, document, memory or
 * decision from its id alone. It only redirects: the page it leads to checks access (and a person
 * who is signed out signs in and comes back here, through the proxy).
 */
export async function GET(request: Request, context: RouteContext<"/w/[slug]/link/[id]">) {
  const { slug, id } = await context.params;
  const path = pathOf(slug, id);
  if (!path) return new Response("Not a Phean link", { status: 404 });
  return Response.redirect(new URL(path, request.url), 307);
}
