import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly and data files that must be loaded from node_modules at runtime.
  // ws (the WebSocket server @vercel/functions upgrades with) breaks when bundled; load it from node_modules.
  serverExternalPackages: ["@electric-sql/pglite", "ws"],
};

export default nextConfig;
