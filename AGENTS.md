<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Working on Phean

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. The rules below are the ones that are easy to break.

### Commands

- `pnpm check` (typecheck, lint, tests) must pass before every commit. Run `pnpm build` too when touching routes, layouts, or anything imported at module load.
- `pnpm test:e2e` builds and runs the Playwright UI tests on port 3200 against `.data/e2e`. Run it after any UI change. It needs `pnpm exec playwright install chromium` once, and it reuses a server already listening on 3200, so stop a stale one after rebuilding. To rerun without rebuilding: `pnpm exec playwright test`.
- CI (`.github/workflows/ci.yml`) runs `pnpm check` and `pnpm test:e2e` on every pull request.
- `pnpm dev` and `pnpm db:seed` both use the on-disk PGlite database by default, and PGlite allows one process at a time. Stop the dev server before seeding.
- `PageProps<"/route">` and `LayoutProps<"/route">` are generated types. `pnpm typecheck` runs `next typegen` first, so a fresh checkout has them; a bare `tsc` will not.

### Where code goes

- Business rules live in `src/server/domain` as `service(schema, run)` functions, which validate their own input. Routes, server actions, and MCP tools are thin adapters that take the service itself; they never query the database themselves.
- Tenant scoping comes only from `Ctx`, which is built from a verified agent token or session. Every query on a tenant table filters through `inTenant(ctx, table)` or `tenantRow(ctx, table, id)`, and every insert sets `tenantId` from `ctx`. Never accept a tenant id or slug from tool input.
- Update services build their `set` with `patchOf`, so `undefined` means "leave it" and `null` means "clear it" everywhere, and throw `invalid` when nothing would change.
- Authorization is the matrix in `src/server/domain/policy.ts`. Call `assertCan` in the service; do not scatter role checks in UI or adapters. `goal:decide` stays human-only.
- An MCP tool that is one service is `serviceTool({ name, title, description, service, key })` in `src/server/mcp/tools.ts`; use `defineTool` only when the tool adds links or formats text. Mark read-only tools `readOnly` and deleting tools `destructive`, and write descriptions for the agent that will read them.
- New workspace mutations are one `tenantAction(service, options)` line in `src/app/w/[slug]/actions.ts`, rendered with `ActionForm`, or `ActionButton` for a one-click post of fixed fields.
- Labels and colors for statuses, priorities, roles, and kinds come from the `{ label, tone }` tables in `src/lib/domain.ts`. Paths come from `routes` in `src/lib/routes.ts`. Field limits come from `LIMITS` and the slug rule from `WORKSPACE_SLUG_PATTERN`, for the schema and the form alike. Do not hard-code any of them.
- Dates are UTC calendar days through `src/lib/dates.ts` (`isoDayFromToday`, `daysBetween`, `isPastDue`), in the app, the scripts, and the tests.
- `src/lib` is client-safe and must not import from `src/server`.

### Database

- Change the schema in `src/server/db/schema`, then `pnpm db:generate` and commit the SQL in `drizzle/`. Migrations only move forward and run on every Vercel build, so keep them compatible with the previous release.
- Nothing may open the database at import time; `next build` runs without one. Use `getDb()` inside functions, or `lazyDb` where a handle must exist at module load.

### UI

- [DESIGN.md](DESIGN.md) is the visual system; read its Do's and Don'ts before styling anything. The tokens live in `src/app/globals.css`, and keep the two in step when you change either.
- Tailwind's default palette is switched off (`--color-*: initial`). Use the token names (`ink`, `muted`, `panel`, `sunken`, `rule`, `shell`, `signal`, `late`, `wait`, `move`, `arrive`, `station-*`); `bg-blue-500` will not exist.
- Signal yellow is for the one primary action and the active tab. Red is only for lateness, danger, and the now line. Status hues come from the tone tables and `components/charts/stations.ts`, never picked in a component.
- Four weights only: `font-normal` for running text, `font-semibold` for labels, `font-bold` for titles and figures, `font-extrabold` for the page title and the display. Figures take `font-stretch-condensed`. Inline text links get the `link` utility; the first cell of a wide table gets `PINNED_CELL` from `components/ui/table.ts`.
- Manual task and goal entry stays quiet (DESIGN.md's Agents First Rule): `ManualEntry` in a page header, or a ghost `Popover` in a card header. Never lay an add form open on a page. `ManualEntry`'s Task/Goal radios share one name, so render it once per page.
- `cx` joins classes; it does not merge them. Pass a class that conflicts with a component's own and both apply, so add a prop or a variant instead.
- Charts are server-rendered spans placed by `lib/timeline.ts` fractions. Keep the maths in `lib` (with unit tests) and the layout in `components/charts`. Every diagram needs a text equivalent for screen readers, and state must not rely on colour alone.
- Form controls are `w-full` by design and class order cannot override it. Size the wrapper (a grid column or a `div` with a width) instead of the control.
- Reuse the primitives before writing markup: `ActionButton`, `GoalField` (goal and parent pickers), `CopyField`, `FlowStat`, `GoalLink`, `segment` from `components/ui/segmented.ts`, `TH` and `PINNED_CELL` from `components/ui/table.ts`, and `Button`'s `pending` state.
- Destructive actions take a `confirm` message on `ActionForm` or `ActionButton`.

### Tests

- Tests run against in-memory PGlite through the real services and the real MCP handler. Add a case to `tests/isolation.test.ts` for anything that reads or writes tenant data, and to `tests/policy.test.ts` for any permission change.
- A database test seeds its own workspace with `seedWorkspace(db)` in `beforeEach` and never reads what another test wrote. `pnpm exec vitest run --sequence.shuffle` catches a test that does.
- UI tests in `e2e/` find things the way a person does: by role, label, and visible text. `card(page, title)` relies on `Card` rendering a `<section>` and `CardHeader` an `<h2>`. The diagrams expose `data-task`, `data-segment`, `data-end`, `data-now`, and `data-tick` for assertions a person makes by eye; keep them when you restyle.
- Specs share the seeded demo account through the `setup` project because sign-in is rate limited. Read-only specs use the seeded Globex workspace and its three weeks of history; a spec that writes creates its own account and workspace with `newWorkspace` (`e2e/support/accounts.ts`), so specs can run in parallel.
- Sign-up allows three per 10 seconds from one client, and the specs together already use most of that. A spec signs up at most one person; a second person is the demo account in its own browser context (`DEMO_SESSION`), and the spec undoes what it changed for them.
- Move between workspace tabs with `openTab` (`e2e/support/navigation.ts`), which waits for the new URL. Pages share controls (memory and search both have a search box), so acting before navigation finishes can hit the page being left.
- Every new page goes into `PAGES` in `e2e/quality.spec.ts` (axe and the 375px checks), and every new timetable into `TIMETABLES`.
