# Phean on BYO

Phean's shared base (tenancy, people and agent auth, policy, events, webhooks, MCP plumbing, Next adapters, test harness) has been extracted into [`@byo/core`](https://github.com/orweis/byo). Phean will depend on it. The full plan, with its evidence, is in [byo/docs/MIGRATION.md](https://github.com/orweis/byo/blob/claude/byo-agent-saas-framework-g0iq0u/docs/MIGRATION.md).

## Why Phean goes first

BYO's tables are Phean's tables. Running drizzle-kit over Phean's schema with the framework tables swapped in yields exactly one statement:

```sql
ALTER TYPE "public"."actor_type" ADD VALUE 'system';
```

Persistent identifiers stay as they are: the `phn_` keys, `Phean-*` headers, `PHEAN_*` env vars, `phean:*` OAuth scopes, the HKDF salt for webhook secrets, and `workspace` in webhook payloads.

## Checklist (one PR each, `pnpm check` and `pnpm test:e2e` green after each)

- [ ] Add `@byo/core` (git dependency) and `transpilePackages: ["@byo/core"]`. Add `src/byo.ts` calling `defineProduct`, filled from `lib/permissions.ts`, `DENIAL_MESSAGES`, `webhooks/routing.ts`, `lib/links.ts` and `eventUrl`.
- [ ] Schema: `export * from "@byo/core/schema"`, drop the duplicated tables, generate migration `0018` (the single `ALTER TYPE` above).
- [ ] `server/db/*` becomes `@byo/core/db` (`createDatabase(schema)`).
- [ ] `domain/{service,errors,context,policy,agent-liveness,agents,events,webhooks,tenants}.ts` becomes `@byo/core/domain`.
- [ ] `server/auth/*` becomes `@byo/core/auth` (`lazyAuth`, `deploymentVerifier`). Rebuild `session.ts` and `workspaces.ts` on `createWebRuntime`.
- [ ] `webhooks/*` becomes `@byo/core/webhooks`.
- [ ] `mcp/{tool,handler,links}.ts` becomes `@byo/core/mcp`. Tools become `[...coreTools({ whoami, exclude }), ...PHEAN_TOOLS]`.
- [ ] Route files use the factories. `tests/support` re-exports `@byo/core/testing`. Existing suites stay unchanged.
- [ ] Later (BYO phase 3): realtime stream, questions and decisions, documents, memory and UI primitives move into BYO modules.
