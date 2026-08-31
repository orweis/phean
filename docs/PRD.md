# Phean - Product Requirements Document

## Problem

Modern knowledge work generates tasks faster than humans can collect them. Action items arrive scattered across email threads, Slack messages, calendar invites, and hallway conversations. The act of *gathering* them into one trusted system - before any actual work happens - is itself a recurring, unrewarding chore. It is Sisyphean: every morning the boulder is back at the bottom of the hill.

Existing task managers assume the human is the operator: the human captures, categorizes, prioritizes, and updates. AI agents can now do most of that, but they lack a shared, structured, persistent workspace built for agent operation with human oversight.

## Vision

**The human points at the hill; the agent rolls the boulder.**

Phean inverts the operator model. The human's job shrinks to two things: defining/approving goals and making judgment calls. The connected AI agent does everything else - collecting tasks from its connectors, triaging them into goals, tracking progress, and completing tasks where possible.

## Personas

- **The Human (Owner)** - a busy professional drowning in scattered action items. Wants a single trustworthy picture of "what's on my plate and how it ladders up to my goals," without doing data entry. Retains authority: goals only become active with their approval.
- **The Agent (Operator)** - an AI assistant (Cursor, Claude, etc.) with its own connectors to email, Slack, calendar, and more. Needs structured tools and clear operating guidance to manage the owner's tasks reliably across sessions.

## Product shape

Phean is an **MCP server**. This is the core product decision:

- The agent is the UI. There is no Phean app to open; all interaction is conversational, mediated by whatever agent the human already uses.
- **Connectors are the agent's job, not Phean's.** The agent already has email/Slack/calendar access through its own integrations. Phean supplies *guidance* (server instructions and prompts) that teaches the agent how to scan those sources and feed findings into Phean's tools. This keeps Phean small, private, and connector-agnostic.
- Phean is the persistent brain and ledger: durable storage, structure, search, planning scaffolds, and visualization.

## MVP scope

### In scope

1. **Goal management** - create, update, list, archive. Goals carry an approval flag; the agent proposes (`proposed`), the human approves (`active`).
2. **Task intake** - bulk capture of tasks with source metadata (`email`, `slack`, `calendar`, `chat`, `manual`, `other`). New tasks land in an `inbox` status awaiting triage.
3. **Triage** - assign tasks to goals, set priority and due dates, drop noise.
4. **Task lifecycle** - `inbox -> todo -> in_progress -> done` (or `dropped`).
5. **Search** - full-text search (SQLite FTS5) plus structured filters across tasks and goals.
6. **Visualization** - Mermaid diagrams returned as text through MCP tools, rendered by the agent's chat UI: goal tree, kanban board, due-date timeline.
7. **Detailed planning** - `plan_goal` returns a structured breakdown scaffold the agent fills in with the human; `suggest_next_actions` surfaces what to do next.
8. **Guidance** - server instructions plus `triage_inbox`, `daily_review`, and `scan_sources` prompts encoding the Phean operating loop.

### Out of scope (MVP)

- Built-in connectors (email/Slack/calendar polling) - delegated to the agent.
- Web UI or dashboard - the agent's chat is the UI.
- Multi-user support, auth, sync, or hosting - single-user, local, stdio transport.
- Recurring tasks, reminders/notifications, time tracking.
- Automatic task execution - the agent executes using its own capabilities; Phean only tracks.

## The human-approval principle

The agent proposes; the human disposes. Concretely:

- Goals created by the agent default to `proposed` and are not treated as active until the human approves.
- Bulk destructive operations (dropping many tasks, abandoning goals) require explicit human confirmation in conversation - guidance instructs the agent to ask.
- Everything else (capturing, triaging, updating status, completing verified work) the agent does autonomously.

## Success criteria

1. A user can connect Phean to Cursor or Claude Desktop with one config block and no other setup.
2. Starting from an empty database, an agent following only Phean's built-in guidance can: capture a batch of tasks from a source sweep, triage them into human-approved goals, and render a coherent kanban and goal tree - within a single conversation.
3. "What should I do next?" returns a sensibly prioritized answer (priority, then due date, then age).
4. State survives across sessions: a new conversation days later picks up exactly where the last one left off.
5. The whole server stays small enough to read in one sitting (single SQLite file, no ORM, one dependency).

## Risks

- **Agent compliance** - guidance is advisory; agents may skip the approval flow. Mitigation: encode the rules in server instructions (always in context) and in every relevant tool description.
- **Mermaid rendering variance** - not all clients render all diagram types. Mitigation: stick to widely supported diagrams (flowchart, kanban, gantt) and always include a plain-text fallback summary alongside.
- **Inbox rot** - capture without triage recreates the original problem. Mitigation: `daily_review` prompt and status summaries that surface inbox size loudly.
