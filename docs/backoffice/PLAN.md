# Backoffice: plan

Status: built. Sub-agents were not available to the session that built it, so the design-stage critiques and the post-build reviews below were done as separate, deliberate passes by the same session. The backoffice is Phean's internal operator console, where Phean's own team reads
customer usage for product and BI work. It is read-only, reachable only by platform admins, and every
look at it is written to an audit log.

## What we learnt from other consoles

Borrow:

1. **A KPI row with its comparison beside it** (Stripe's Home, Vercel's Usage): every figure says what
   it is compared with ("+12% on the 7 days before"), never a bare arrow.
2. **One period per screen, chosen once** (Vercel Usage, Amplitude): the overview reads trailing 7-day
   windows; the trend charts read the 12 windows ending today. Trailing windows rather than calendar
   weeks, so the latest bar holds six whole days and today so far, never the half week a calendar week
   shows on a Thursday (which always looks like a drop). We chose to end on today, not yesterday, so the
   console shows today's activity; the latest bar is short by at most what is left of today.
3. **Funnels with conversion and median time between steps** (PostHog, Amplitude): a step's count, its
   rate from the step before and from the start, and how long people took.
4. **Retention as a cohort grid** (PostHog's retention table, Mixpanel): rows are signup weeks, columns
   are weeks since signup, cells the share active; a period that has not fully happened yet stays blank.
5. **Tables that are the work surface** (Retool, Linear's admin): search, sort by any column, server-side
   pagination, one link per row into a detail page, and an export of exactly the rows the filters chose.
6. **Health flags on the row, not a separate page** (Stripe's risk badges, Vercel's failing deployments):
   dormant, decisions stuck, webhooks failing, each a word as well as a tone.
7. **Customer content behind a deliberate step with a reason** (Stripe's and Intercom's
   "view as customer" with a logged reason; Linear's audit log): metadata is free to read, content is not.
8. **An audit log people can read** (Linear's and GitHub's audit logs): who looked at what, when, with
   which filters, and why for content.

Avoid:

1. **Vanity totals without a definition.** Every metric has its SQL semantics written down here and on
   the page (the (?) beside each card).
2. **Charts that need a library and ship JavaScript.** Bars are server-rendered spans, like the app's own
   charts, each with a table that says the same for screen readers.
3. **Scanning the raw log for every page view.** The overview reads a daily rollup (`usage_daily`) with
   today computed live.
4. **Admin-only code paths that bypass the domain rules quietly.** Cross-tenant reads are a separate,
   named layer (`src/server/backoffice`), with its own context and its own check.

## Route and name

`/admin`. It is the name an operator expects, and hiding it behind an obscure path would add nothing:
access is decided by the session, not the path. Everyone who is not a platform admin gets the same 404
as a missing page, so the console is not advertised to customers; `robots` disallows it and every page
is `noindex`. The proxy sends signed-out visitors to sign in first (as it does for `/w/…`), and only then
does the page decide between the console and a 404.

## Who gets in

- **Platform admins only**: `isPlatformAdmin` (a *verified* email listed in `PHEAN_PLATFORM_ADMINS`).
- **Two-factor**: required everywhere by default. `PHEAN_ADMIN_REQUIRE_2FA=0` turns it off only where
  `VERCEL_ENV` is unset (local development, the UI tests); every Vercel deployment, previews included,
  requires it. When required and the admin has no two-factor, every page shows the gate ("Turn on
  two-factor to use the backoffice") and no data; when not required, a banner asks them to turn it on.
  The service checks it too, not only the page.
- **A workspace's own pages** (`/w/[slug]`), for a platform admin who is not a member, go through the
  same gate (`platformWorkspaceAccess`, from `requireWorkspace`): two-factor when required, and a live
  "Show content" grant for that workspace. Without one the admin is sent to the workspace's backoffice
  page to give a reason; "Open read-only" appears only while the grant lasts, and the first visit in a
  grant is recorded (`view.workspace_app`). `/workspaces` still lists every workspace for them.
- **Agents never**: there are no backoffice MCP tools, and `PlatformCtx` is built only from a session.

## Security model

- `PlatformCtx = { db, admin: { id, email, name } }`, built only by `requireBackoffice()` from the
  signed-in session (`src/server/backoffice/session.ts`), the way `personContext` is for `/account`.
- Every backoffice read is a `platformService(name, schema, run)`: it parses its input, then
  `assertPlatformAdmin` **re-reads the person's row** (verified email, listed address, two-factor when
  required) before running, and writes one audit row. A non-admin, an agent id, an unverified address
  or a missing two-factor is `forbidden`, whatever the page did.
- **No `inTenant` here, by design.** These services read across tenants on purpose. They never write
  tenant tables, never build a `Ctx`, and are never reachable from MCP or `tenantAction`. This is the one
  documented exception to the tenant-scoping rule (AGENTS.md, ARCHITECTURE.md).
- **Read-only.** The only writes are the audit log, and the daily rollup the cron route fills.
- **Never shown**: tokens, token prefixes, key hashes, webhook secrets or header values, VAPID keys,
  push endpoints or keys, passwords, two-factor secrets or backup codes, session tokens, IP addresses.
  Queries select named columns only, so a new secret column never leaks by `select *`. A webhook shows
  its host, never its full URL (paths and queries carry tokens on automation platforms).
- **Content is a second step.** By default every screen shows aggregates and metadata: names of
  workspaces, people and agents, counts, times, states. Customer content (task titles and descriptions,
  decision questions, context and answers, memories, documents, event summaries) appears only on a
  workspace's page after **Show content**, a form that takes a reason (at least 10 characters). That
  writes a `content.reveal` audit row; for 30 minutes the same admin may read that workspace's recent
  content (`getWorkspaceContent`, itself audited), then it hides again. Memories and documents are not
  shown even then: titles and decisions answer "what is this customer doing" without their files.

## Audit

`backoffice_audit`: `id`, `at`, `admin_user_id`, `admin_email` (kept if the person is deleted),
`action` (`view.overview`, `view.workspaces`, `export.workspaces`, `content.reveal`, …),
`tenant_id` (when the action is about one workspace), `subject_user_id` (a person looked up),
`filters` (the service's parsed input: search, sort, page), `reason` (for content). Written by
`platformService` for every call, so every page view and every export is a row; the Audit page lists
them (and reading it is audited too). No retention limit: rows are small and the trail is the point.

## Information architecture

A tab rail under the glass header (the workspace rail's pattern), denser pages in the same 80rem frame:

| Tab | Route | Shows |
| --- | --- | --- |
| Overview | `/admin` | KPI row, 12-week trends |
| Activation | `/admin/activation` | Funnel, signup-cohort retention |
| Workspaces | `/admin/workspaces` | Searchable, sortable, paginated table; CSV export |
| (detail) | `/admin/workspaces/[slug]` | Members, agents, activity, decisions, pipelines, webhooks, push, storage, Show content |
| People | `/admin/people` | Search by email; recent signups by default |
| Agents | `/admin/agents` | By client, level, sub-agents, weekly active, top tools and errors |
| Usage | `/admin/usage` | Feature adoption, actions, MCP tools, sign-in methods |
| Health | `/admin/health` | Webhook and push delivery, backlog, pipeline lag, rate limits, table sizes, rollup freshness |
| Audit | `/admin/audit` | Who looked at what |

States: one `loading.tsx` frame for every tab (a title, a strip and cards pulsing); empty states (`EmptyState`) for a fresh deployment ("No
workspaces yet", "No signups in these 12 weeks"); errors fall to the app's error boundary with
`ErrorNotice`; an unknown workspace slug is a 404 inside the console.

## Metric definitions

Days are UTC calendar days (`lib/dates.ts`). "Today" is the UTC day now.

- **Window**: a trailing 7-day window ending today, `[today − 6, today]` (today so far: see Borrow 2). "Last week" is the one before
  it, `[today − 13, today − 7]`. The 12-week trends are 12 such windows back to back, oldest first, each
  labelled by its last day.
- **Actor kinds**: a person (`events.actor_type = 'user'`), an agent (`'agent'` whose `agents.auth_kind`
  is not `system`), and the pipelines agent (`system`), which never makes anything "active".
- **Active person (WAU)**: a person who was the actor of at least one event, in any workspace, in the
  window. Reading pages is not an event, so a person who only looked does not count.
- **Active agent (WAA)**: a non-system agent that was the actor of at least one event, or made at least
  one MCP tool call (`tool_calls_daily`), in the window.
- **Active workspace (WAW)**: a workspace with at least one event by a person or a non-system agent, or
  one tool call, in the window.
- **Totals**: workspaces = rows in `organization`; people = rows in `user`; connected agents =
  non-system agents not revoked and not past `access_expires_at`.
- **New signups**: `user.created_at` in the window. **New workspaces**: `organization.created_at` in it.
- **Decisions asked**: `task.input_requested` events (questions and decisions alike: an agent's request
  is a "decision" in Phean's vocabulary). **Answered**: `task.input_answered` events (a person answered,
  or marked it answered elsewhere). **Median time to answer**: over closed requests in
  `tasks.input_answers` with outcome `answered` or `answered_elsewhere` and `closedAt` in the window,
  the median of `closedAt − askedAt`.
- **Tasks captured**: `task.captured` events (by hand or by an agent). **Completed**: `task.completed`
  events plus `task.updated` events whose `data.status` is `done` (the rollup's synthetic `task.done`).
- **Handoffs**: `task.handed_off` events.
- **Pipeline runs**: `pipeline_runs.started_at` in the window. **Success rate**: of runs that *ended* in
  the window (`ended_at`), the share whose status is `done`; failed and cancelled count against it.
- **Activation funnel** (cohort: people who signed up in the last 12 weeks):
  1. *Signed up*: `user.created_at`.
  2. *Created a workspace*: their first `member` row with role `owner` (time: its `created_at`). People
     who only joined by invitation are counted beside the funnel, not in it.
  3. *Connected an agent*: their first non-system agent with `created_by_user_id` = them.
  4. *First decision asked*: the first `task.input_requested` event in a workspace they own.
  5. *First decision answered*: their first `task.input_answered` event as the actor.
  6. *Active in week 2*: an event as actor in days 7–13 after signup; counted only for people who signed
     up at least 14 days ago (the denominator says so).
  7. *Active in week 4*: days 21–27 after signup; people who signed up at least 28 days ago.
  Each step shows its count, the rate from the step before and from signup, and the median time from
  the step before (steps 1–5 only; weeks are fixed offsets).
- **Retention grid**: rows are signup weeks (12 trailing 7-day windows, by signup day), columns are
  weeks since signup (week 0 = days 0–6). A cell is the share of the cohort active (event as actor) in
  that week; a week not fully over for everyone in the cohort is left blank.
- **Health flags** (per workspace, pure in `lib/backoffice.ts`): *dormant* (created more than 14 days
  ago and no activity in 14 days), *decisions stuck* (an open request asked more than 3 days ago),
  *webhooks failing* (a webhook disabled, or 3 or more failures in a row).
- **Feature adoption**: per feature, the workspaces with at least one of its events in the last 28 days,
  as a count and a share of the workspaces active in those days. Features map to actions in
  `ADOPTION_FEATURES` (decisions, answers, handoffs, goals, pipelines, documents, memory, webhooks, linked sessions). Sub-agents are counted on the Agents page instead: `agent.created` does not say whether the agent is one.
  Push is person-level (`push_devices`), two-factor is `user.two_factor_enabled`; themes are a cookie and
  never reach the server, so they are not measured (see Deferred).

## Data and queries

- **`usage_daily`** `(day, tenant_id, actor_type, actor_id, action) → events`: events counted per day,
  workspace, actor and action, plus the synthetic `task.done`. One table answers the trends (sum), the
  active counts (distinct actors), adoption (distinct workspaces per action) and the funnel's later
  weeks. Filled by `rollUpUsage`, which recomputes whole days (delete then insert-select, in one
  transaction, so it is idempotent), from the day after the last one it finished (at most 120 days back)
  through yesterday (every day with `full`, which the seed uses after backdating). An advisory lock
  (`pg_advisory_xact_lock(hashtext('usage_rollup'))`) taken first makes overlapping runs queue. Readers
  take rolled-up rows through the last stored day and compute every day after it (today at least, more
  when the cron has stalled) live from `events` with the same SQL. `events_created_idx (created_at)`
  makes a day's scan a range.
- **Indexes on busy tables are not in the migration.** `events_created_idx`,
  `events_action_created_idx (action, created_at)` and `tasks_answered_updated_idx (updated_at) where
  input_answers <> '[]'` are built `CONCURRENTLY` by `ensureBackofficeIndexes`, which the rollup cron
  and the seed call outside any transaction: migrations run in a transaction during the deploy, while
  the previous release still serves, and a plain `CREATE INDEX` on `events` would block its writes. A
  build cut off part way leaves an invalid index, which the next run drops and builds again.
- **Cron**: `/api/admin/rollup`, hourly at minute 17 in `vercel.json`, authorized like the other crons
  (`Authorization: Bearer $CRON_SECRET`, or any caller on a non-production deployment without one).
- **`tool_calls_daily`** `(day, tenant_id, agent_id, tool) → calls, errors`: MCP calls counted by
  `scheduleToolCount` in the MCP handler, one upsert per call after the answer (`waitUntil`), never the
  input or the result. Errors are results with `isError` (domain refusals and internal errors alike) and
  calls that threw before reaching their tool (counted against the credential's agent).
- **Funnel's first events**: `task.input_requested` and `task.input_answered` are read through
  `events_action_created_idx`, so only those events are touched.
- **Answer times** expand only tasks updated in the window (closing a request updates its task), through
  `tasks_answered_updated_idx`. The Workspaces table's answered count and median cover the last 28 days.
- **Workspaces table**: one statement of grouped CTEs (members, agents by level, tasks by state,
  decisions open and their oldest, answers with `percentile_cont`, pipelines and runs, webhooks failing,
  last event per tenant through `events_tenant_created_idx`), then `ORDER BY` the chosen column,
  `LIMIT 25 OFFSET`. Search is `ILIKE` on name, slug and owner email. At thousands of workspaces this is
  a few grouped scans per page view; if it grows, the same columns can move into a nightly
  `workspace_stats` rollup without changing the page.
- **Health**: delivery counts read the outbox tables' last 24 hours; table sizes read
  `pg_total_relation_size` over `pg_stat_user_tables`; rate-limit counters are grouped by endpoint, the
  address never read out.

## Charts

`WeekBars` (`components/charts/week-bars.tsx`): one bar per window, heights from `barFractions` in
`lib/backoffice.ts`, the latest bar in `accent`, the others `accent/40`, a value on hover and focus, and
a visually hidden table with every window's figure. The funnel is a row of horizontal `ProgressBar`s;
the retention grid is a table whose cells take an `accent` wash in five steps (`retentionStep`) and
always print their percentage, so colour is never the only cue.

## Review notes (design stage)

The plan was critiqued twice before building: once as the BI user who reads it every Monday, once as a
security reviewer.

BI user:
- Half weeks always read as a drop: trailing full windows instead of calendar weeks (done).
- A median without its sample size misleads: medians print "of N" (done).
- Week-2 and week-4 activity must not count people who have not reached those weeks (done: per-step
  denominators).
- The overview must say what "active" means on the page (done: (?) tips with the definitions).
- Exports must carry the filters they were made with (done: the CSV is the table's query, and the
  audit row records it).

Security reviewer:
- Re-check admin status in the service from the database, not from the session object a page passed
  (done).
- A webhook URL can carry a token in its path or query: show the host only (done).
- Rate-limit keys contain client addresses: group by endpoint, never print the key (done).
- Content reveal must expire and be per admin and per workspace (done: 30 minutes, keyed on both).
- CSV cells starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'` so a
  spreadsheet does not run them (done: `toCsv`).
- 404 rather than 403 for everyone else, including for the export route (done).

## Deferred

- Themes adoption: the theme is a cookie; measuring it needs a client beacon, which the separate
  analytics work may add.
- True rate-limit *hits* (429s): Better Auth keeps counters, not refusals; counting refusals needs a hook
  where it answers 429.
- Error logs beyond MCP tool errors (route handler failures) need a log sink.
- A `workspace_stats` rollup for the Workspaces table, when the number of workspaces calls for it.
- Saved views and scheduled exports.
- An audit retention policy.
