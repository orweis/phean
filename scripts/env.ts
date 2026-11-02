/**
 * Loads .env files with Next.js's own precedence, so scripts see the same DATABASE_URL as `next dev`.
 * Import it before anything that reads process.env at module load.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
