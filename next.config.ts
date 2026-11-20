import type { NextConfig } from "next";

/** Every path except `/w/[slug]/documents/[id]/file` (path-to-regexp, as Next matches `source`). */
const EVERY_PAGE_BUT_DOCUMENT_FILES = "/:path((?!w/[^/]+/documents/[^/]+/file$).*)";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly and data files that must be loaded from node_modules at runtime.
  // ws (the WebSocket server @vercel/functions upgrades with) breaks when bundled; load it from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "ws"],
  // The docs site reads its Markdown from content/docs at request time.
  outputFileTracingIncludes: { "/docs": ["./content/docs/**"], "/docs/[slug]": ["./content/docs/**"], "/llms.txt": ["./content/docs/**"], "/llms-full.txt": ["./content/docs/**"], "/privacy": ["./content/legal/**"] },
  headers: async () => [
    // Baseline for every response. The workspace pages are full of one-click actions (Revoke, Forget,
    // answering a decision), so nothing may frame them. The one exception is a document's file, which
    // the document page embeds (PDFs in an <object>) and which sets its own same-origin policy.
    {
      source: EVERY_PAGE_BUT_DOCUMENT_FILES,
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        // Browsers ignore HSTS over plain HTTP, so local servers are unaffected.
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
      ],
    },
    // A framed dialog could trick someone into clicking Allow. Both headers, for browsers that read only one.
    {
      source: "/oauth/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ],
    },
  ],
};

export default nextConfig;
