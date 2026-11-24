/**
 * The backoffice's paths. They live here, not in `lib/routes.ts`, which client bundles and the
 * service worker (`public/sw.js`) carry: nothing a customer downloads names the console.
 */
type Query = Record<string, string | undefined>;

function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export const adminPaths = {
  overview: () => "/admin",
  activation: () => "/admin/activation",
  /** The workspaces table: search words, sort column and direction, health flag, page. */
  workspaces: (query?: Query) => withQuery("/admin/workspaces", query),
  /** The same rows as CSV, with the same filters. */
  workspacesExport: (query?: Query) => withQuery("/admin/workspaces/export", query),
  workspace: (slug: string) => `/admin/workspaces/${slug}`,
  /** A workspace's content card, where an admin gives the reason that opens its content and its app pages. */
  workspaceContent: (slug: string) => `/admin/workspaces/${slug}#content`,
  people: (query?: string) => withQuery("/admin/people", { q: query }),
  agents: () => "/admin/agents",
  usage: () => "/admin/usage",
  health: () => "/admin/health",
  audit: (page?: number) => withQuery("/admin/audit", { page: page && page > 1 ? String(page) : undefined }),
  /** The hourly cron that rolls the event log up into `usage_daily`. */
  rollup: () => "/api/admin/rollup",
} as const;

/** The backoffice's tabs, in rail order; the layout hands them to the (client) tab rail as plain data. */
export const ADMIN_PAGES = [
  { key: "overview", label: "Overview", href: adminPaths.overview(), exact: true },
  { key: "activation", label: "Activation", href: adminPaths.activation(), exact: false },
  { key: "workspaces", label: "Workspaces", href: adminPaths.workspaces(), exact: false },
  { key: "people", label: "People", href: adminPaths.people(), exact: false },
  { key: "agents", label: "Agents", href: adminPaths.agents(), exact: false },
  { key: "usage", label: "Usage", href: adminPaths.usage(), exact: false },
  { key: "health", label: "Health", href: adminPaths.health(), exact: false },
  { key: "audit", label: "Audit", href: adminPaths.audit(), exact: false },
] as const;
export type AdminPageKey = (typeof ADMIN_PAGES)[number]["key"];
export type AdminPage = (typeof ADMIN_PAGES)[number];
