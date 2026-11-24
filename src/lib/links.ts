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

/** What each prefix names, in words analytics may carry (`copy_link`'s `kind`). */
export const LINK_KINDS = { t: "task", g: "goal", d: "document", m: "memory", q: "request", p: "pipeline", r: "run" } as const satisfies Record<keyof typeof LINKS, string>;
export type LinkKind = (typeof LINK_KINDS)[keyof typeof LINK_KINDS];

export function isLinkableId(id: unknown): id is string {
  return typeof id === "string" && LINKABLE_ID.test(id);
}

/** The in-app path that shows the object an id names, or null for an id Phean does not link. */
export function pathOf(slug: string, id: string): string | null {
  if (!isLinkableId(id)) return null;
  return LINKS[id.slice(0, 1) as keyof typeof LINKS](slug, id);
}

/** The kind of thing an id names, by its prefix, or null for an id Phean does not link. */
export function linkKindOf(id: string): LinkKind | null {
  return isLinkableId(id) ? LINK_KINDS[id.slice(0, 1) as keyof typeof LINK_KINDS] : null;
}

/**
 * The kind of thing an in-app path shows, by the last linkable id in it (`/w/acme/tasks/t_1` is a
 * task, `/w/acme/decisions?focus=q_1` a request), or null when it names none.
 */
export function linkKindOfPath(path: string): LinkKind | null {
  // The workspace's slug is not an id, whatever it looks like.
  const ids = path.replace(/^\/w\/[^/?#]+/, "").split(/[/?&=#]/).filter(isLinkableId);
  return ids.length ? linkKindOf(ids.at(-1)!) : null;
}
