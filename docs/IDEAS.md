# Feature review and next ideas

A review of what Phean does as of November 2026, the gaps it showed, and ideas for what to build next, roughly in order of value for effort. Nothing here is committed work; each idea names the existing piece it would build on.

## What Phean does today

- **One ledger, many agents.** Agents connect over MCP (45 tools, 4 prompts), capture work with de-duplication on `(source, source_ref)`, claim tasks atomically, and share memory and documents. Sub-agents act under their own names, either with their own tokens or relayed through a parent's (`actingAs`, `Phean-Agent-Name`).
- **People decide.** Goals that agents propose wait for a person's approval. Agents ask questions and decisions (single or multiple answers) with options, a recommendation, links, and a way back into their session. Answers reach agents once, through `wait_for_answers`, `collect_answers`, a webhook, or the realtime stream.
- **Access you can read.** OAuth approval in the browser with a level (Read, Write or Admin) and a lifetime, fixed keys for bots, per-workspace MCP addresses, and revocation that cascades to sub-agents and takes effect on the next request.
- **Being told instead of polling.** Signed, retried webhooks, and a WebSocket stream at `/api/events` for agents with no public endpoint.
- **The web app.** An overview and Decisions page led by what waits on a person; a board whose lanes are the workspace's stages, split into People and Agents rows; the timetable and cumulative flow; memory, documents, search, archiving; a favicon that counts what waits on you; Light, Dark and System appearances.
- **Sign-in.** Email and password, plus GitHub and Google once their OAuth apps are configured.

## Gaps this review found (fixed in this change)

- **No docs site.** The landing page linked nowhere past sign-up. There is now `/docs`, from `content/docs`, with `llms.txt` and `llms-full.txt` for agents.
- **Stale documentation.**
  - README's tool table and skills section missed documents, sub-agents, `update_memory`, the Admin tools and the documents skill.
  - PRODUCT.md still described `phn_` keys as the way agents connect.
  - ARCHITECTURE.md had the wrong realtime failure count, an old agent role and a miscounted list.
  - `.env.example` lacked the Blob, webhook-key and cron variables.
- **A landing page that told rather than showed.** It now demonstrates the loop: a survey map of the slope, a sample morning, and the real connect command.

## Ideas

### Small, high leverage

1. **A morning digest.** One message a day per person: what the agents finished overnight, what is late, and what waits on them, each line a link. It builds on `get_status_summary` and the overview's queries, and goes out as email, or as a webhook to a person's own bot so Phean still needs no connectors.
2. **Decisions with a deadline.** Let `request_input` take a `neededBy` date. The Decisions page would sort by it, turn a missed one red under the Red Line Rule, and let the agent say what it will do by default when the deadline passes ("I'll pick the recommendation on Friday"). That turns a silent block into a visible, bounded wait.
3. **Answer from the notification.** Signed, single-use links in a digest or a bot's message that answer a decision with one option, so a person can decide from their phone without signing in. Each link is scoped to one request and one option, and expires when the request closes.
4. **Docs search.** A search box over `content/docs`, using the same Postgres full-text search as the workspace, or a static index built at deploy time.

### Medium

5. **Recurring goals.** A goal that comes back on a schedule ("Close the month", "Weekly investor update") with its checklist of tasks. It is the boulder rolling back down the hill, made into a feature. Each recurrence is a new goal instance, so the timetable keeps its history.
6. **Agent scorecards.** On the Agents page, per agent: tasks done, median claim to done, questions asked per task, how long people take to answer it, and releases. Everything comes from the event log that already exists. It helps people trust, or retire, a given agent.
7. **Approval rules.** Let owners pre-approve goals that match a rule (proposed by a named agent, under an existing active goal, with no more than N tasks). They would be recorded as approved by the rule, never by the agent, so `goal:decide` stays human-authored.
8. **MCP resource subscriptions.** Expose goals, tasks and requests as MCP resources and support `resources/subscribe`, so clients that implement it get changes natively, without a webhook or a WebSocket. It reuses `reasonsFor` and the realtime stream's cursor.
9. **A shared goal page for customers.** For operators who run Phean for customers: a read-only, revocable link to one goal's timetable and progress, with no task notes or memory, so the customer sees progress without a seat.

### Larger bets

10. **Import from issue trackers.** One-time and ongoing import from Linear, GitHub Issues or Jira as captured tasks, with `source_ref` set to the issue URL, so de-duplication and the Resume link work unchanged. It could be done by a first-party agent that uses the public MCP rather than a connector built into the server.
11. **Budgets on goals.** Agents report time or spend against a goal (`complete_task` with a cost), and the goal page shows burn against a budget a person set. A goal over budget waits on a person.
12. **A hosted "first agent".** A built-in agent a new workspace can switch on, which reads a forwarded inbox address and captures tasks, so someone can see the loop work before connecting their own agents. It is the main step off the landing page today that still asks for setup.

## Follow-ups outside the code

- **Social sign-in in production.** GitHub and Google OAuth apps and their four variables in Vercel. This was handed to a local session, since it needs the owner's accounts.
- **A production check of the realtime stream on Vercel.** In particular, whether the socket survives the idle and deadline behaviour that local tests cannot reproduce.
