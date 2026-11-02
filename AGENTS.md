<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Working on Phean

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. The rules below are the ones that are easy to break.

### Commands

- `pnpm check` (typecheck, lint, tests) must pass before every commit. Run `pnpm build` too when touching routes, layouts, or anything imported at module load.
- `pnpm dev` and `pnpm db:seed` both use the on-disk PGlite database by default, and PGlite allows one process at a time. Stop the dev server before seeding.
- `PageProps<"/route">` and `LayoutProps<"/route">` are generated types. If typecheck cannot find them, run `pnpm exec next typegen`.

### Where code goes

- Business rules live in `src/server/domain` as `service(schema, run)` functions. Routes, server actions, and MCP tools are thin adapters that reuse `service.schema`; they never query the database themselves.
- Tenant scoping comes only from `Ctx`, which is built from a verified agent token or session. Every query filters by `ctx.tenant.id`, and every insert sets `tenantId` from it. Never accept a tenant id or slug from tool input.
- Authorization is the matrix in `src/server/domain/policy.ts`. Call `assertCan` in the service; do not scatter role checks in UI or adapters. `goal:decide` stays human-only.
- New MCP tools go through `defineTool` in `src/server/mcp/tools.ts`. Mark read-only tools `readOnly` and deleting tools `destructive`, and write descriptions for the agent that will read them.
- New workspace mutations are one `tenantAction(...)` line in `src/app/w/[slug]/actions.ts`, rendered with `ActionForm`.
- Labels and colors for statuses, priorities, roles, and kinds come from the `{ label, tone }` tables in `src/lib/domain.ts`. Paths come from `routes` in `src/lib/routes.ts`. Do not hard-code either.
- `src/lib` is client-safe and must not import from `src/server`.

### Database

- Change the schema in `src/server/db/schema`, then `pnpm db:generate` and commit the SQL in `drizzle/`. Migrations only move forward and run on every Vercel build, so keep them compatible with the previous release.
- Nothing may open the database at import time; `next build` runs without one. Use `getDb()` inside functions, or `lazyDb` where a handle must exist at module load.

### UI

- Form controls are `w-full` by design and class order cannot override it. Size the wrapper (a grid column or a `div` with a width) instead of the control.
- Destructive actions take a `confirm` message on `ActionForm`.

### Tests

- Tests run against in-memory PGlite through the real services and the real MCP handler. Add a case to `tests/isolation.test.ts` for anything that reads or writes tenant data, and to `tests/policy.test.ts` for any permission change.
