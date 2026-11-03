# Phean - Product Requirements Document

## Problem

Knowledge work produces tasks faster than people can collect them. Action items are scattered across email threads, Slack messages, calendar invites, and meetings. Just gathering them into one trusted system, before any real work starts, is a recurring and unrewarding chore. It is Sisyphean: every morning the boulder is back at the bottom of the hill.

Existing task managers assume a person operates them: the person captures, categorizes, prioritizes, and updates. AI agents can now do most of that work, but teams of agents have no shared, structured, persistent place to do it with human oversight. Today each agent keeps its own notes, duplicates the others' work, and leaves no audit trail.

## Vision

**Humans set the goals. Agents roll the boulder.**

Phean flips who operates the system. People do two things: decide which goals matter, and make the judgment calls. A team of AI agents does the rest. They collect tasks from their own connectors, triage them into goals, coordinate who does what, complete what they can, and remember what they learned.

## Personas

- **Workspace owner.** A founder, manager, or consultant drowning in scattered action items for one team or customer. Wants one trustworthy picture of what is on the plate and how it ladders up to goals, without doing data entry. Keeps authority: goals become active only with a person's approval.
- **Agent.** An AI assistant (Cursor, Claude Code, background agents) with its own email, Slack, and calendar integrations. Needs structured tools, operating guidance, and a shared ledger with the other agents in the workspace.
- **Operator.** Runs Phean for several customers, for example a Permit team serving its accounts. Wants status per customer at a glance: what is overdue, what is waiting on a decision, and which agents are active.

## Product shape

Phean is a **hosted, multi-tenant service** with two faces over one ledger:

1. **A remote MCP server** that agents connect to with a per-agent token. It provides both the *guidance* (server instructions and prompts that teach the operating loop and multi-agent etiquette) and the *tools* (CRUD, search, planning, memory, and visualization).
2. **A web app** where people sign in, create workspaces, invite teammates, connect agents, approve goals, and watch progress.

Connectors stay with the agents. Phean never holds email or Slack credentials. It is the shared brain and ledger.

## Scope

### In scope

1. **Accounts and workspaces.** Email and password sign-up, plus GitHub and Google when configured. A person can belong to several workspaces (tenants), each fully isolated. Roles: owner, admin, member. Invitations are shared as links.
2. **Agents per workspace.** Owners and admins issue named agent tokens. Each token is shown once, stored hashed, and revocable. Any number of agents share one workspace.
3. **Goals as a hierarchy.** Goals and sub-goals up to four levels deep, with progress rolled up from every descendant. Agents propose goals, and only people approve, achieve, or abandon them.
4. **Task intake and triage.** Bulk capture with source metadata. Items already captured by another agent, matched on source plus source reference, are skipped. New items land in the inbox, and filing them under a goal triages them.
5. **Coordination.** Agents claim tasks before working on them, and a second claim is refused with the claimant's name. Next-action suggestions skip work claimed by others. A shared activity feed lets each agent catch up on what the rest did.
6. **Hand-offs between agents and people.** An agent leaves its session on each task it works on: a link to its conversation or message where it has one (ideal: one click from Phean), otherwise its session and message ids and the command that resumes it, plus a one-line brief. When it needs a person, it asks one question on the task. The question waits on the person's overview with the way back into the agent's conversation, and can be answered there or in Phean, where the agent reads the answer on the task.
7. **Long-term memory.** Facts, preferences, decisions, and context that any agent can save and every agent in the workspace can recall, optionally linked to a goal or task.
8. **Search.** Full-text, prefix-matching search across goals, tasks, and memory.
9. **Planning and views.** `plan_goal` returns a planning scaffold. Mermaid goal tree, kanban, and timeline views render in the agent's chat.
10. **Web status views.**
   - Status per workspace: open, inbox, overdue, due this week, done in the last 7 days, waiting on you (goals to decide and agent questions), active agents, last activity.
   - A workspace dashboard, kanban board, goal pages, memory, search, agent management, and members.
   - Platform admins get the same per-customer view across every workspace, read-only.
11. **Hosting.** Runs entirely on Vercel, with Neon Postgres as the single store.

### Out of scope (for now)

- Built-in connectors. Scanning sources is the agents' job.
- MCP OAuth for clients that cannot send headers (they can use the `mcp-remote` bridge for now).
- Email delivery: invitations, notifications, digests.
- Semantic (embedding) memory search. `pgvector` is available when needed.
- Recurring tasks, reminders, time tracking, billing.
- Fine-grained authorization beyond the role matrix (the `can()` seam is ready for Permit.io).

## The human-approval principle

The agent proposes; the human disposes. This is enforced by the server, not left to prompts:

- Goals created by agents always start as `proposed`. Goals created by people start `active`.
- Only people can change a goal's status. Agents get a review link to hand to their human.
- Agents can forget only the memories they saved themselves.
- Everything else (capturing, triaging, claiming, completing verified work) agents do on their own, and it is attributed to them in the activity log.

## Success criteria

1. Someone can go from sign-up to a connected agent in under two minutes: create a workspace, issue a token, paste the generated config.
2. Two agents connected to the same workspace never capture the same source item twice and never both work on the same task.
3. The owner sees what the agents did, what is overdue, and what awaits a decision or an answer on one screen, refreshed without reloading.
4. From any task an agent worked on, a person gets back into that agent's conversation in one click when the agent gave a link, or with ids and a command ready to copy when it did not.
5. An operator sees status across all customer workspaces in one table.
6. No request can read or change another workspace's data. This is covered by isolation tests at the service, MCP, and database levels.
7. State survives across sessions and agents: a new agent connecting days later picks up the goals, claims, and memory exactly where the others left them.

## Risks

| Risk | Mitigation |
| --- | --- |
| Agents ignore the guidance | Critical rules are enforced in services (approval, claims, dedupe, memory ownership), not just written in prompts |
| Cross-tenant leaks | The tenant comes only from a verified token or session. Every query is tenant-scoped, composite foreign keys make cross-tenant links impossible, and isolation tests cover all of it |
| Leaked agent token | Hashed at rest, shown once, last-seen visible, revocable instantly |
| A task stalls silently on a person | Agents ask with `request_input`; open questions lead the overview and count on the Overview tab and in the workspaces table, and `suggest_next_actions` skips tasks waiting on a person |
| A session link that is not what it says | Only `https`, `http`, and known agent and chat app schemes are accepted; web links open in a new tab without access to Phean's window, and the guidance tells agents to link only their own conversations |
| Inbox rot | The dashboard and status summary surface the inbox count, and the `daily_review` prompt pushes triage |
| Mermaid rendering varies by client | Widely supported diagram types only, always with text alongside |
