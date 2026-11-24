import type { NextConfig } from "next";

/**
 * The baseline Content Security Policy for app pages (docs/apps/PLAN.md §4, "Web app"): no plugins,
 * no `<base>` from elsewhere, never framed, and workers only from this origin. It has no
 * `form-action` on purpose: Chrome applies that to the redirects after a form post, which would break
 * the OAuth dialog's redirect to `cursor://`, `vscode://` and loopback clients. A nonce-based
 * `script-src` is a follow-up. The marketing site, the docs and the blog keep the browser defaults.
 */
const APP_CSP = ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "worker-src 'self'"].join("; ");

/**
 * Workspace pages show a PDF document in an `<object>` from this origin's file route, which sends
 * its own sandboxing policy; so there `object-src` allows this origin only.
 */
const WORKSPACE_CSP = APP_CSP.replace("object-src 'none'", "object-src 'self'");

const APP_PAGES = ["/workspaces/:path*", "/account/:path*", "/admin/:path*", "/invite/:path*", "/sign-in/:path*", "/sign-up/:path*", "/offline"];

/** Every workspace page, but not a document's bytes (`/w/[slug]/documents/[id]/file`), which set a stricter policy of their own. */
const WORKSPACE_PAGES = ["/w/:slug", "/w/:slug/:rest((?!documents/[^/]+/file$).*)"];

const csp = (value: string) => ({ key: "Content-Security-Policy", value });

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly and data files that must be loaded from node_modules at runtime.
  // ws (the WebSocket server @vercel/functions upgrades with) breaks when bundled; load it from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "ws"],
  // The docs site reads its Markdown from content/docs at request time.
  outputFileTracingIncludes: { "/docs": ["./content/docs/**"], "/docs/[slug]": ["./content/docs/**"], "/llms.txt": ["./content/docs/**"], "/llms-full.txt": ["./content/docs/**"], "/privacy": ["./content/legal/**"] },
  headers: async () => [
    ...APP_PAGES.map((source) => ({ source, headers: [csp(APP_CSP)] })),
    ...WORKSPACE_PAGES.map((source) => ({ source, headers: [csp(WORKSPACE_CSP)] })),
    // A framed dialog could trick someone into clicking Allow (or the desktop app's sign-in). Both headers, for browsers that read only one.
    ...["/oauth/:path*", "/native/:path*"].map((source) => ({
      source,
      headers: [{ key: "X-Frame-Options", value: "DENY" }, csp(APP_CSP)],
    })),
    // The service worker is checked for an update on every navigation, and may control the whole origin.
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache" },
        { key: "Service-Worker-Allowed", value: "/" },
        csp("default-src 'self'"),
      ],
    },
  ],
};

export default nextConfig;
