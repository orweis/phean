import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** The database and its query builder: only `src/server` (services, the data layer) may reach them. */
const DATABASE = {
  group: ["@/server/db", "@/server/db/*", "**/server/db/*", "drizzle-orm", "drizzle-orm/*", "pg", "@electric-sql/*", "@vercel/postgres"],
  message: "Pages, components and lib never touch the database. Call a service in src/server/domain, or a bound entry point in src/server/entry.ts.",
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/**", "src/components/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [DATABASE] }] },
  },
  {
    files: ["src/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [DATABASE, { group: ["@/server", "@/server/*", "**/server/*"], message: "src/lib is client-safe and must not import from src/server." }] },
      ],
    },
  },
  globalIgnores(["public/sw.js", ".next/**", "out/**", ".data/**", "drizzle/**", "next-env.d.ts", ".claude/**"]),
]);
