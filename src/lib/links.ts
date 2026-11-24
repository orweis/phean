import { routes } from "./routes";

/**
 * What a Phean id links to, by its prefix: a task, goal, document or memory, one request (a
 * question or decision, open or answered), a pipeline or one of its runs. Client-safe, so the app, the permalink route and the
 * MCP tools all build the same links.
 */
const LINKS = {
  t: (slug: string, id: string) => routes.task(slug, id),
  g: (slug: string, id: string) => routes.goal(slug, id),
  d: (slug: string, id: string) => routes.document(slug, id),
  m: (slug: string, id: string) => routes.memoryItem(slug, id),
  q: (slug: string, id: string) => routes.request(slug, id),
  p: (slug: string, id: string) => routes.pipeline(slug, id),
  r: (slug: string, id: string) => routes.pipelineRun(slug, id),
} as const;

/** Ids Phean gives the things a link can name: a prefix, an underscore, then the id itself. */
const LINKABLE_ID = /^(t|g|d|m|q|p|r)_[A-Za-z0-9]+$/;

export function isLinkableId(id: unknown): id is string {
  return typeof id === "string" && LINKABLE_ID.test(id);
}

/** The in-app path that shows the object an id names, or null for an id Phean does not link. */
export function pathOf(slug: string, id: string): string | null {
  if (!isLinkableId(id)) return null;
  return LINKS[id.slice(0, 1) as keyof typeof LINKS](slug, id);
}
