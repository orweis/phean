/** The account `pnpm db:seed` creates; local only, never on a real deployment. */
export const DEMO_USER = { name: "Dana Demo", email: "demo@phean.dev", password: "phean-demo-password" };

export const DEMO_WORKSPACES = [
  { name: "Acme Corp", slug: "acme" },
  { name: "Globex", slug: "globex" },
] as const;

/** Gets backdated sample history so the timeline has something to draw on first run. */
export const SAMPLE_HISTORY_SLUG = "globex";
