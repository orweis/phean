# Contributing to Phean

Thanks for helping. Phean is a Next.js app with a Postgres (or embedded PGlite) database, an MCP server for agents, and a web app for people.

## Before you start

- Read [AGENTS.md](AGENTS.md). It lists the rules that are easy to break (tenant scoping, where business rules live, how agents authenticate, UI conventions) and applies to people and coding agents alike.
- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the code layout, and [DESIGN.md](DESIGN.md) before styling anything.
- Report security issues privately, as [SECURITY.md](SECURITY.md) describes, not in a public issue or pull request.

## Set up

Requires Node.js 22 (see `.node-version`) and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm db:seed   # local PGlite database with demo data
pnpm dev       # http://localhost:3000
```

## Before every commit

```bash
pnpm check     # typecheck, lint, unit and integration tests
pnpm build     # when you touch routes, layouts, or anything imported at module load
pnpm test:e2e  # after any UI change (run `pnpm exec playwright install chromium` once first)
```

Tests run against in-memory PGlite through the real services and MCP handler, so they need no network or secrets. Add a case to `tests/isolation.test.ts` for anything that reads or writes tenant data, and to `tests/policy.test.ts` for any permission change.

## Pull requests

- Keep each pull request to one change, with a description of what and why.
- Schema changes go through `pnpm db:generate`, and the generated SQL in `drizzle/` is committed. Migrations only move forward and must stay compatible with the previous release.
- Add a line under a new version heading in [CHANGELOG.md](CHANGELOG.md) for anything a deployment's operator or a user would notice, and say plainly when a change needs action on upgrade.
- Never commit secrets, tokens or `.env` files.

## Dependencies

The auth stack (`better-auth`, `@better-auth/*`, `auth`), the MCP packages, Next.js and a few rendering libraries are pinned to exact versions and move together on purpose; other packages use caret ranges. Bump the Better Auth packages in lockstep, run `pnpm auth:schema` to confirm the schema did not drift (then discard purely cosmetic changes) and `pnpm db:generate` to confirm nothing needs a migration. Dependabot opens grouped update pull requests weekly.
