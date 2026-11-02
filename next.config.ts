import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly and data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
