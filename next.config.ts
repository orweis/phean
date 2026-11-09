import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly and data files that must be loaded from node_modules at runtime.
  // ws (the WebSocket server @vercel/functions upgrades with) breaks when bundled; load it from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "ws"],
  // The docs site reads its Markdown from content/docs at request time.
  outputFileTracingIncludes: { "/docs": ["./content/docs/**"], "/docs/[slug]": ["./content/docs/**"], "/llms.txt": ["./content/docs/**"], "/llms-full.txt": ["./content/docs/**"] },
  // A framed dialog could trick someone into clicking Allow. Both headers, for browsers that read only one.
  headers: async () => [
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
