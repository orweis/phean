# Changelog

All notable changes to Phean are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). While Phean is below 1.0, a minor bump (0.x.0) marks a change that may need action from whoever runs a deployment; read its **Upgrading** notes.

## [0.3.0] - 2026-11-20

### Upgrading

- **Self-hosted and preview deployments must set `CRON_SECRET`.** `/api/webhooks/dispatch` and `/api/digest` used to accept any caller when `CRON_SECRET` was unset unless `VERCEL_ENV` was `production`, so a self-hosted production server or a Vercel preview without the secret left both routes open to the internet. They now refuse every call without the secret on any production build; only a local development server (`pnpm dev`, with `NODE_ENV` set to `development`; an unset `NODE_ENV` counts as a deployment) runs them unauthenticated. Vercel production deployments that already set `CRON_SECRET` need no change. If you run your own scheduler, send `Authorization: Bearer <CRON_SECRET>`.
- **Images from other hosts in agent Markdown no longer load.** They show as a link the reader can open instead (see Security). Images on the deployment's own origin are unchanged.

### Security

- Post-sign-in redirects (`?next=`) refuse paths containing tabs, newlines or other control characters or whitespace, which browsers strip and so turned `/%09/evil.example` into a link to another site (open redirect).
- The cron routes fail closed without `CRON_SECRET` (above) and compare the bearer in constant time, through one shared helper (`src/server/cron-auth.ts`).
- Webhook sends are pinned to the address the SSRF check approved (`createPinnedFetch`), closing DNS rebinding between the check and the connection. These sends do not use an `HTTP_PROXY`/`HTTPS_PROXY` egress proxy. IPv4-compatible, 6to4 and Teredo IPv6 addresses now count as private.
- Every page refuses to be framed (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), not only `/oauth`, so one-click workspace actions cannot be clickjacked. A document's file may be framed by Phean's own pages only, for the PDF viewer. Responses also send `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and `Strict-Transport-Security` on production builds.
- Agent-written Markdown no longer loads images from other hosts, which could tell those hosts who read a document and when.
- `pnpm.overrides` move two dev-only transitive dependencies to patched versions: esbuild under `@esbuild-kit/core-utils` (GHSA-67mh-4wv8-2f99, via drizzle-kit) and minimatch below 11.0.1 (GHSA-g3hv-75wg-m249, via eslint). `pnpm audit` is clean.
- The security docs now say that invitations are bearer links: Phean does not confirm email addresses, so whoever holds a link can accept it.

### Changed

- Dependencies: better-auth and its `@better-auth/*` plugins and the `auth` CLI 1.7.17 to 1.7.26 (no schema change), mcp-handler 2.4.0, mermaid 12.3.0, @vercel/blob 2.9.0, @vercel/functions 3.11.3, ws 8.23.0, @electric-sql/pglite 0.5.17, lucide-react 1.77, tailwindcss and @tailwindcss/postcss 4.3.5, vitest 5.1.1, eslint 10.15, @playwright/test 1.65.1.
- CI runs with a read-only token, pins every action to a commit SHA, has job timeouts, and reports `pnpm audit --prod` without failing. Dependabot proposes npm and GitHub Actions updates weekly.

### Added

- Tests for the cron routes' authorization, the pinned webhook connection and DNS rebinding, the security headers, Markdown rendering of untrusted input, the open-redirect cases, and a check that the README's MCP tool counts and tool table match the server.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, a pull request template, and `.node-version`.
- README: a docs table separating user, contributor and internal planning docs, a testing overview and troubleshooting. The tool table now lists `hand_off_task` and `cancel_hand_off`.

## [0.2.0]

The state of Phean before this changelog was kept. See the git history for earlier changes.

