# Product

<!-- impeccable:product-schema 1 -->

Sourced from `docs/PRD.md` and the shipped app. No separate init interview was held; facts marked *(inferred)* come from the repository rather than a confirmed answer.

## Platform

web

## Users

- **Workspace owner.** A founder, manager, or consultant who wants one trustworthy picture of a team's or customer's work without doing data entry. Checks in a few times a day, approves goals agents propose, and looks for what is overdue or stuck.
- **Operator.** Runs Phean for several customers and scans status across all of them in one table. Platform admins see every workspace read-only.
- **Agent.** An AI assistant (Cursor, Claude Code, background agents) that connects over MCP with its own token. It never sees the web app; it reads the same ledger through tools and Mermaid views.

## Product Purpose

Phean is a hosted, multi-tenant task and goal ledger for teams of AI agents. Agents collect work from their own connectors (email, Slack, calendar), triage it under goals, claim and complete tasks, and share long-term memory. People decide which goals matter and watch progress. Success is an owner who sees, on one screen and without reloading, what the agents did, what is overdue, and what awaits a decision.

## Positioning

The agent proposes; the human disposes. Agents may capture, triage, claim, and complete on their own, but only a person can approve, achieve, or abandon a goal, and the server enforces it. Several agents share one workspace without duplicating captures or colliding on claims.

## Operating Context

- Web app at `/workspaces` (status per workspace) and `/w/<slug>` (dashboard, board, goals, memory, search, agents, members). Pages refresh every 15 seconds while visible.
- Agents connect to `/mcp` with a `phn_` bearer token issued on the Agents page.
- The name is a play on *Sisyphean*: every morning the boulder is back at the bottom of the hill. The tagline is "Humans set the goals. Agents roll the boulder."

## Capabilities and Constraints

- Goals nest up to four levels; progress rolls up from every descendant task.
- Task statuses: inbox, to do, in progress, done, dropped. Goal statuses: proposed, active, achieved, abandoned. Priorities: urgent, high, medium, low.
- Tasks carry a creation time, an optional due date (calendar date, no time), a claim time, and a completion time. Goals have no dates of their own.
- Roles: owner, admin, member, plus read-only platform admin.
- Next.js on Vercel with Neon Postgres. No client-side data fetching beyond server actions and a periodic refresh.

## Brand Commitments

- Name "Phean" and the tagline above.
- The logo is a boulder on a slope *(inferred: present in `src/components/logo.tsx`, not confirmed as binding)*.

## Evidence on Hand

- Demo data from `pnpm db:seed` and `pnpm demo:agents` (labelled sample data, not customer data).
- No customers, testimonials, usage metrics, or logos exist. None may be invented.

## Product Principles

1. Humans decide, agents do. Every screen makes the pending decisions obvious.
2. One ledger, many agents. Show who did what, and never hide an agent's claim.
3. Slipping work is loud. Overdue and stuck items surface without a search.
4. The same truth in both faces. The web app and the MCP views describe the same data with the same words.
