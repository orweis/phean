/** Every in-app path, built in one place so pages, redirects, and MCP links agree. */
export const routes = {
  home: () => "/",
  signIn: (next?: string) => (next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"),
  signUp: (next?: string) => (next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"),
  workspaces: () => "/workspaces",
  workspace: (slug: string) => `/w/${slug}`,
  board: (slug: string, goalId?: string) => `/w/${slug}/board${goalId ? `?goal=${encodeURIComponent(goalId)}` : ""}`,
  goal: (slug: string, goalId: string) => `/w/${slug}/goals/${goalId}`,
  memory: (slug: string) => `/w/${slug}/memory`,
  search: (slug: string, query?: string) => `/w/${slug}/search${query ? `?q=${encodeURIComponent(query)}` : ""}`,
  agents: (slug: string) => `/w/${slug}/agents`,
  members: (slug: string) => `/w/${slug}/members`,
  invite: (invitationId: string) => `/invite/${invitationId}`,
  mcp: () => "/mcp",
} as const;

/** Only same-origin relative paths are honored as post-login redirects. */
export function safeNextPath(next: string | null | undefined, fallback: string = routes.workspaces()): string {
  // "//host" and "/\host" are protocol-relative URLs to another origin in browsers.
  return next && /^\/(?![/\\])/.test(next) ? next : fallback;
}
