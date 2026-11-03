type Query = Record<string, string | undefined>;

/** Appends the defined, non-empty query values to a path. */
function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/** Every in-app path, built in one place so pages, redirects, and MCP links agree. */
export const routes = {
  home: () => "/",
  signIn: (next?: string) => withQuery("/sign-in", { next }),
  signUp: (next?: string) => withQuery("/sign-up", { next }),
  workspaces: () => "/workspaces",
  workspace: (slug: string) => `/w/${slug}`,
  /** The overview's list of agent questions waiting on a person. */
  questions: (slug: string) => `/w/${slug}#questions`,
  board: (slug: string, goalId?: string) => withQuery(`/w/${slug}/board`, { goal: goalId }),
  timeline: (slug: string, filters?: { goal?: string; days?: string }) => withQuery(`/w/${slug}/timeline`, filters),
  goal: (slug: string, goalId: string) => `/w/${slug}/goals/${goalId}`,
  memory: (slug: string, filters?: { kind?: string; q?: string }) => withQuery(`/w/${slug}/memory`, filters),
  search: (slug: string, query?: string) => withQuery(`/w/${slug}/search`, { q: query }),
  agents: (slug: string) => `/w/${slug}/agents`,
  members: (slug: string) => `/w/${slug}/members`,
  invite: (invitationId: string) => `/invite/${invitationId}`,
  mcp: () => "/mcp",
} as const;

/** A single non-empty search param value; Next passes repeated keys as arrays. */
export function queryParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

/** Only same-origin relative paths are honored as post-login redirects. */
export function safeNextPath(next: string | null | undefined, fallback: string = routes.workspaces()): string {
  // "//host" and "/\host" are protocol-relative URLs to another origin in browsers.
  return next && /^\/(?![/\\])/.test(next) ? next : fallback;
}
