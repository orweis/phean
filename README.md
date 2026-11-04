# Phean

**A Sisyphean-proof task and goal ledger for AI agents.** You point at the hill; your agents roll the boulder.

Phean is a hosted, multi-tenant service where people set direction and AI agents do the legwork. Each workspace (a team or a customer) has its own goals, tasks, and long-term memory. Any number of agents connect to a workspace over MCP and share them: they sweep their own connectors (email, Slack, calendar, chat) for work, capture it, group it under goals, claim tasks so they don't collide, and complete what they can. People sign in to a web app to see status per workspace, approve the goals agents propose, and step in where needed.

- **Remote MCP server** at `/mcp`: 34 tools and 4 prompts, plus operating instructions that teach agents the loop and the multi-agent rules.
- **Web app**: status across workspaces, an overview per workspace, a kanban board, a timeline, goal pages, shared memory, search, agent tokens, and members. Progress reads like a railway timetable: every task is a track from the day it was captured, stepping down through its stations (inbox, to do, in progress, done) against a red line for now.
- **Storage**: Postgres (Neon on Vercel), with hierarchical goals, full-text search, and an activity log, all scoped to the workspace.

Docs: [PRD](docs/PRD.md) · [UX](docs/UX.md) · [Design system](DESIGN.md) · [Product context](PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) · [Hosted multi-tenant plan](docs/plans/hosted-multi-tenant.md)

## Quickstart

Requires Node.js 22 and pnpm 10 (`corepack enable`). Locally, Phean uses an embedded PGlite database in `.data/`, so there is nothing else to install.

```bash
git clone https://github.com/orweis/phean.git
cd phean
pnpm install
pnpm db:seed      # demo account, two workspaces, two agent tokens, three weeks of Globex history
pnpm dev          # applies migrations, then serves http://localhost:3000
```

Sign in as `demo@phean.dev` / `phean-demo-password`. To watch two agents share the Acme workspace, run this in another terminal with the two tokens the seed printed:

```bash
pnpm demo:agents http://localhost:3000 phn_first_token phn_second_token
```

The demo captures tasks (one duplicate is skipped), proposes goals, races two claims on one task (one is refused), completes work, asks you a question about another, and saves shared memory. The dashboard updates within 15 seconds, with the question and the proposed goals waiting on you.

PGlite allows one process at a time, so stop `pnpm dev` before running `pnpm db:seed`. To use a real Postgres instead, set `DATABASE_URL` (see [`.env.example`](.env.example)).

## Connect an agent

On a workspace's **Agents** page, an owner or admin issues a token. It is shown once, with ready-made setup for Cursor, Claude Code, and VS Code. For Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "phean-acme": {
      "url": "https://<your-domain>/mcp",
      "headers": { "Authorization": "Bearer phn_..." }
    }
  }
}
```

For Claude Code:

```bash
claude mcp add --transport http phean-acme https://<your-domain>/mcp --header "Authorization: Bearer phn_..."
```

The token identifies both the agent and its workspace. Each agent gets its own token, so its work is attributed to it and it can be revoked on its own.

### Webhooks: telling bots what changed

A bot that runs as a service registers an HTTPS endpoint with `register_webhook`. Phean then POSTs signed JSON to it within moments of:
- a person answering the bot's question or deciding on a goal it proposed;
- a change to a task, goal or memory the bot follows.

A bot follows everything it captured, claimed, asked about, updated, created or saved, plus whatever it `watch`es, and never hears about its own changes. Delivery is at-least-once and ordered per bot, with retries and backoff. Requests carry `Phean-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`. An endpoint that needs its own key (an `Authorization` header, say) gets it through `register_webhook`'s `headers`, which are stored encrypted and sent with every request. Bots verify the signature on the raw body, in constant time, and reject a `t` older than 5 minutes; [`skills/phean-webhooks/SKILL.md`](skills/phean-webhooks/SKILL.md) has copy-paste Node and Python verifiers. The Agents page shows each agent's webhook and its health. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#webhooks-telling-bots-what-changed) for the design.

### Agent skills

Two installable skills teach agents what the server instructions cover in short, with worked examples, and load only when needed.

[`skills/phean-webhooks/SKILL.md`](skills/phean-webhooks/SKILL.md) is for bots that receive webhooks. It covers:

- registering the endpoint and keeping the secret;
- verifying `Phean-Signature`, with Node and Python verifiers the tests run against real signatures;
- rejecting replays and de-duplicating retried events;
- what to do with each event.

[`skills/phean-decisions/SKILL.md`](skills/phean-decisions/SKILL.md) teaches an agent how to ask you for decisions through Phean:

- when to mark a request `kind: "decision"` (with options) and when `"question"`;
- how to write the question, the context, and its recommendation;
- which links to attach (`conversation`, `source`, `doc`);
- how to tell you, then wait for or collect your answer, and act on it.

Install them where your client reads skills. For Claude Code:

```bash
mkdir -p ~/.claude/skills && cp -r skills/phean-decisions skills/phean-webhooks ~/.claude/skills/
```

Use `.claude/skills/` inside a project instead to share them with everyone working there. Other clients that support Agent Skills take the same folder.

## The loop

1. **Sync up**: see what other agents and people did since last time.
2. **Scan and capture**: sweep the agent's own connectors and capture tasks with their source. Items any agent already captured are skipped.
3. **Triage**: file tasks under goals, set priorities and due dates, propose new goals.
4. **Approve**: a person approves or rejects proposed goals in the web app. Agents cannot.
5. **Execute**: claim a task with the agent's session (a link to its conversation, or its session id and resume command), do it, complete it with a note. Claims keep agents from colliding.
6. **Ask**: when a task needs a person, the agent records it with `request_input`: a question, or a decision with options, plus its context and recommendation and links back to the conversation and the sources. It shows on the **Decisions** page and the overview as waiting on you, with a one-click link back into the agent's conversation. You pick an option or write an answer in Phean (or answer in the conversation). An agent blocked in `wait_for_answers` wakes as soon as you answer; others pick the answer up with `collect_answers`, each answer delivered once.
7. **Review**: status summaries and Mermaid views (goal tree, kanban, timeline) in chat, or the web app's overview, timetable, and cumulative flow.
8. **Remember**: durable facts, preferences, and decisions go into memory that every agent in the workspace can recall.

## MCP tools

| Area | Tools |
| --- | --- |
| Identity | `whoami` |
| Goals | `create_goal`, `update_goal`, `list_goals`, `get_goal` |
| Tasks | `capture_tasks`, `list_tasks`, `get_task`, `update_task`, `assign_tasks_to_goal` |
| Coordination | `claim_task`, `release_task`, `complete_task`, `suggest_next_actions`, `get_activity` |
| Hand-offs to people | `link_session`, `request_input`, `wait_for_answers`, `collect_answers`, `resolve_input` |
| Webhooks | `register_webhook`, `get_webhook`, `ping_webhook`, `delete_webhook`, `watch`, `unwatch`, `list_watches` |
| Memory | `remember`, `recall`, `forget` |
| Search and planning | `search`, `plan_goal` |
| Views | `visualize` (goal tree, kanban, timeline), `get_status_summary` |

Prompts: `sync_up`, `scan_sources`, `triage_inbox`, `daily_review`.

Agents keep tasks accurate instead of capturing duplicates. `get_task` reads one task whole: its links, sessions, questions, parent, subtasks, and history. `update_task` changes only the fields it is given, including `source` and `sourceRef`. It adds or removes single links (`addLinks`, `removeLinks`) and attaches a task to a parent (`parentTaskId`, or null to detach it). Subtasks go one level deep and inherit their parent's goal; cards show the parent and "2 of 3 subtasks done".

## Web app

| Page | What it shows |
| --- | --- |
| `/workspaces` | Status per workspace: open, inbox, overdue, due this week, done, waiting on you (goals to decide and agent questions), active agents, last activity |
| `/w/:slug` | Overview: a status sentence, open work by station, agent questions waiting on you, goals awaiting your decision, late tasks, the timetable of the most pressing open tasks, next actions, the goal map, agent workload, and activity |
| `/w/:slug/decisions` | Every question and decision agents asked you: what waits (with context, options to pick, and links) and what was answered, with whether the asking agent has picked the answer up |
| `/w/:slug/board` | Kanban by status, filterable by goal. Drag a card to another lane to move it (onto Done completes it), or use the card's buttons. **Edit** changes a task's title, notes, priority, due date, goal and tags. Links agents left show on the card, beside a Resume control; Done shows the latest five and folds the rest |
| `/w/:slug/timeline` | Cumulative flow and a timetable of every task over 14, 30, or 90 days, grouped by goal and filterable by goal |
| `/w/:slug/goals/:id` | One goal: decisions, progress by station, its timetable, tasks, sub-goals, memory, activity |
| `/w/:slug/memory` | Shared long-term memory, by kind and text |
| `/w/:slug/search` | Full-text search across goals, tasks, and memory |
| `/w/:slug/agents` | Issue and revoke agent tokens, with MCP client setup |
| `/w/:slug/members` | Members, roles, and invitations |

Each agent that works on a task can leave its session on it: a link that opens its conversation or message (`https://`, or an app link such as `cursor://` or `slack://`), its session and message ids, a resume command such as `claude --resume <id>`, and a one-line brief. **Resume** on the task lists them, with the link one click away and the ids ready to copy. When an agent asks a question, **Resume in Claude** (or the agent's app) leads its entry on the overview and the Decisions page, beside **Answer here** for a short reply, or one button per option for a decision. Agents also leave **links** on tasks and questions (`{ url, title, kind }`, where kind is `conversation`, `source`, `doc`, or `other`); they are clickable wherever the task shows.

Agents are meant to fill the ledger, but people can add a task or goal by hand: a quiet **Add manually** button on the overview and board, and **Add task** or **Add sub-goal** on a goal page.

Pages refresh every 15 seconds while open. Owners and admins manage agents and members; members can do everything else, including approving goals. Emails listed in `PHEAN_PLATFORM_ADMINS` get read-only access to every workspace.

## Development

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Apply migrations and start the dev server |
| `pnpm check` | Typecheck, lint, and run the tests |
| `pnpm test` | Vitest: domain services, policy, tenant isolation, members and invitations, configuration, timelines, and MCP over HTTP, against in-memory PGlite |
| `pnpm test:e2e` | Playwright UI tests: builds, serves on port 3200 against a fresh seeded PGlite, and drives Chromium through sign-up, agents over MCP, approvals and goal edits, resuming an agent's session and answering its question, manual entry, the board, memory, search, invitations, the diagrams, accessibility (axe), and phone layouts |
| `pnpm build` | Production build (never connects to the database) |
| `pnpm db:generate` | Generate a SQL migration from schema changes in `src/server/db/schema` |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Create the demo account, workspaces, and agent tokens |
| `pnpm demo:agents <url> <token> <token>` | Run two agents against a deployment |

Run `pnpm exec playwright install chromium` once before the first `pnpm test:e2e`. CI runs `pnpm check` and `pnpm test:e2e` on every pull request.

Code layout and conventions are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [AGENTS.md](AGENTS.md). The visual system (tokens, type, components, and the rules behind them) is in [DESIGN.md](DESIGN.md).

## Deployment

Phean deploys to Vercel as one Next.js app with a Neon Postgres database. The `vercel-build` script applies migrations before building. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for setup, environment variables, and smoke testing.

## License

MIT
