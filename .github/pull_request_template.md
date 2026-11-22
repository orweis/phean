## What and why

<!-- One change per pull request. What does it do, and why? -->

## Checks

- [ ] `pnpm check` passes
- [ ] `pnpm build` passes (if routes, layouts or module-load code changed)
- [ ] `pnpm test:e2e` passes (if the UI changed)
- [ ] Tenant data access has a case in `tests/isolation.test.ts`; permission changes in `tests/policy.test.ts`
- [ ] Schema changes have a generated migration in `drizzle/` that is compatible with the previous release
- [ ] CHANGELOG.md updated for anything an operator or user would notice, with upgrade notes if action is needed
