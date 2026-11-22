import type { TaskQuery } from "./task-views";

type Query = Record<string, string | undefined>;

/** Appends the defined, non-empty query values to a path. */
function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/** The square sizes the app icon is drawn in (`routes.appIcon`), for the web app manifest and notifications. */
export const APP_ICON_SIZES = [192, 512] as const;

/** Every in-app path, built in one place so pages, redirects, and MCP links agree. */
export const routes = {
  home: () => "/",
  /** The public docs site, or one page of it. */
  docs: (slug?: string) => (slug ? `/docs/${slug}` : "/docs"),
  /** The blog's front page (a later page of its stories with `page`), or one post. */
  blog: (slug?: string, page?: number) => (slug ? `/blog/${slug}` : withQuery("/blog", { page: page && page > 1 ? String(page) : undefined })),
  /** The posts carrying one tag. */
  blogTag: (tag: string) => `/blog/tag/${tag}`,
  /** One writer's page: their bio and their posts. */
  blogAuthor: (slug: string) => `/blog/author/${slug}`,
  /** The blog as an RSS feed. */
  blogFeed: () => "/blog/rss.xml",
  privacy: () => "/privacy",
  signIn: (next?: string) => withQuery("/sign-in", { next }),
  signUp: (next?: string) => withQuery("/sign-up", { next }),
  /** The second step of a sign-in, for people with two-factor on: their authenticator code or a backup code. */
  twoFactor: (next?: string) => withQuery("/sign-in/two-factor", { next }),
  /** The signed-in person's own account: how they sign in, and two-factor. */
  account: () => "/account",
  workspaces: () => "/workspaces",
  /** The way into the app: the workspace the person last opened, or their list of workspaces. */
  app: () => "/w",
  workspace: (slug: string) => `/w/${slug}`,
  /** The overview's list of agent questions waiting on a person. */
  questions: (slug: string) => `/w/${slug}#questions`,
  /** Every question and decision agents asked people: what waits, and what was answered. */
  decisions: (slug: string) => `/w/${slug}/decisions`,
  /** One request on the Decisions page, which scrolls to it and rings it. */
  decision: (slug: string, taskId: string) => `/w/${slug}/decisions#task-${taskId}`,
  /** One request, open or answered, on the Decisions page, which opens it and brings it into view. */
  request: (slug: string, requestId: string) => withQuery(`/w/${slug}/decisions`, { focus: requestId }),
  /** The goals waiting on a person's approval, on the Decisions page. */
  approvals: (slug: string) => `/w/${slug}/decisions#approvals`,
  /** The Tasks page: the board by default, or another layout (`view`) with the same filters. */
  board: (slug: string, filters?: string | TaskQuery) =>
    withQuery(`/w/${slug}/board`, typeof filters === "string" ? { goal: filters } : filters),
  /** The tasks of one status as a table, within a goal when given: where the status bars' segments lead. */
  tasksByStatus: (slug: string, status: string, goal?: string) => routes.board(slug, { view: "table", status, goal }),
  timeline: (slug: string, filters?: { goal?: string; days?: string }) => withQuery(`/w/${slug}/timeline`, filters),
  /** Every goal, with a peek into its tasks; `show` picks which (open by default). */
  goals: (slug: string, show?: string) => withQuery(`/w/${slug}/goals`, { show }),
  goal: (slug: string, goalId: string) => `/w/${slug}/goals/${goalId}`,
  /** A task: a peek over the page it was opened from, or its own page on a refresh or a shared link. */
  task: (slug: string, taskId: string) => `/w/${slug}/tasks/${taskId}`,
  memory: (slug: string, filters?: { kind?: string; q?: string }) => withQuery(`/w/${slug}/memory`, filters),
  /** One memory, brought into view on the Memory page. */
  memoryItem: (slug: string, memoryId: string) => withQuery(`/w/${slug}/memory`, { focus: memoryId }),
  /** A permalink for anything with a Phean id (`t_`, `g_`, `d_`, `m_`, `q_`): it redirects to where that thing is shown. */
  link: (slug: string, id: string) => `/w/${slug}/link/${id}`,
  documents: (slug: string, query?: string) => withQuery(`/w/${slug}/documents`, { q: query }),
  document: (slug: string, documentId: string, mode?: "edit") => withQuery(`/w/${slug}/documents/${documentId}`, { mode }),
  /** A document's bytes, served by Phean after it checks access; blobs are never addressed directly. */
  documentFile: (slug: string, documentId: string, download?: boolean) => withQuery(`/w/${slug}/documents/${documentId}/file`, { download: download ? "1" : undefined }),
  /** Search's suggestions as a person types, as JSON. */
  suggest: (slug: string, query: string) => withQuery(`/w/${slug}/suggest`, { q: query }),
  search: (slug: string, query?: string) => withQuery(`/w/${slug}/search`, { q: query }),
  /** A person's morning digest for the workspace, and where they choose when it is emailed. */
  digest: (slug: string) => `/w/${slug}/digest`,
  agents: (slug: string) => `/w/${slug}/agents`,
  members: (slug: string) => `/w/${slug}/members`,
  /** Workspace settings: the board's stages. Reached from the workspace menu, not the tab rail. */
  settings: (slug: string) => `/w/${slug}/settings`,
  invite: (invitationId: string) => `/invite/${invitationId}`,
  /** The shared MCP endpoint, or a workspace's own (`""` gives the prefix every workspace's shares). */
  mcp: (slug?: string) => (slug === undefined ? "/mcp" : `/mcp/w/${slug}`),
  /** The dialog for connecting an MCP client, on the signed query the OAuth provider sent it. */
  oauthApprove: (oauthQuery: string) => `/oauth/approve?${oauthQuery}`,
  /** Where the desktop app's browser sign-in asks the person to confirm, for a request the app registered. */
  nativeAuthorize: (requestId: string) => withQuery("/native/authorize", { request: requestId }),
  /** The form on `nativeAuthorize` posts here; it answers 303 to the app's loopback address. */
  nativeConfirm: () => "/native/authorize/confirm",
  /** Where a notification's button posts its answer (a request id and an option index), and its Undo. */
  pushAnswer: (slug: string) => `/w/${slug}/push/answer`,
  pushUndo: (slug: string) => `/w/${slug}/push/undo`,
  /** The desktop app's feed of open requests across the person's workspaces. */
  nativeInbox: () => "/api/native/inbox",
  /** The realtime event stream agents open over a WebSocket. */
  events: () => "/api/events",
  /** The static page the service worker shows when a navigation cannot reach Phean. */
  offline: () => "/offline",
  /** The service worker, at the root so its scope is the whole origin. */
  serviceWorker: () => "/sw.js",
  /** The app icon as a square PNG, for the web app manifest and notifications (`APP_ICON_SIZES`). */
  appIcon: (size: number) => `/icons/${size}.png`,
} as const;

/** A single non-empty search param value; Next passes repeated keys as arrays. */
export function queryParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

/** Next's search params back as a query string, repeated keys included. */
export function queryStringOf(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const item of [value ?? []].flat()) query.append(key, item);
  return query.toString();
}

/** Any host: only the parsed origin is compared, so this never names a real site. */
const SAME_ORIGIN_PROBE = "https://phean.invalid";

/**
 * Only same-origin relative paths are honored as post-login redirects. "//host" and "/\\host" are
 * protocol-relative URLs to another origin in browsers, and URL parsing drops tabs and newlines
 * anywhere, so "/\t/host" is one too: refuse control characters, then check what a browser would
 * actually resolve the path to.
 */
export function safeNextPath(next: string | null | undefined, fallback: string = routes.workspaces()): string {
  if (!next || !/^\/(?![/\\])/.test(next) || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    return new URL(next, SAME_ORIGIN_PROBE).origin === SAME_ORIGIN_PROBE ? next : fallback;
  } catch {
    return fallback;
  }
}
