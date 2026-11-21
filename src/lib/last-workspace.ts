import { WORKSPACE_SLUG_PATTERN } from "@/lib/domain";

/**
 * The workspace a person last opened, remembered in a cookie so `/w` (`routes.app()`) can take them
 * straight back. It only names a slug: `/w` still checks the person can see that workspace.
 */
export const LAST_WORKSPACE_COOKIE = "phean-workspace";
export const LAST_WORKSPACE_MAX_AGE = 60 * 60 * 24 * 365;

const SLUG = new RegExp(`^${WORKSPACE_SLUG_PATTERN}$`);

/** Whether a value read back from the cookie can be a workspace slug at all. */
export function isWorkspaceSlug(value: string | undefined): value is string {
  return value !== undefined && SLUG.test(value);
}

/**
 * The cookie that remembers a workspace. It is written by the workspace layout as it renders, not
 * by the proxy: the proxy cannot tell a prefetch (a link to another workspace scrolled into view)
 * from a page the person opened.
 */
export function lastWorkspaceCookie(slug: string, secure: boolean): string {
  return [`${LAST_WORKSPACE_COOKIE}=${slug}`, "Path=/", `Max-Age=${LAST_WORKSPACE_MAX_AGE}`, "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}
