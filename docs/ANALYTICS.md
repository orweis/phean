# Analytics

Phean uses Google Analytics 4 (property "Phean", account "Phean", owned by the project owner's Google
account) for funnels, acquisition and UI behaviour on the marketing site, the docs, the blog and the
app. Exact usage per workspace comes from the database (the backoffice), never from GA: GA is never sent
per-workspace data dumps.

- The catalog is `EVENTS` in `src/lib/analytics.ts`. `track(name, params)` takes only the params an event
  lists, in the types it lists, and drops anything else at run time.
- The browser side is `src/components/analytics.tsx` (the loader, page views, outbound clicks, the consent
  bar, `AnalyticsIdentity`, `AnalyticsPage`, `ConsentLink`), rendered by the root layout.
- The server side is `src/server/analytics.ts`: whether pages load GA, the salted hashes, and the
  Measurement Protocol for what agents do with no page open.
- Call sites: `track` in a client handler; the `analytics` prop (a `Tracked` from `src/lib/tracked.ts`) on
  `ActionForm`, `ActionButton`, an undo, `Popover` and `QueryFilter`, which sends only on success (a server
  action may add params it decides, such as `first_answer`, in `data.analytics`); `TrackOnMount` for a server
  page; `TrackedLink` and `TrackedAnchor` for links. The server sends through `trackAfterCommit(ctx, …)` in
  `server/domain/analytics.ts`, which runs after the transaction commits.
- Every new user-facing surface or action adds its events to `EVENTS` and to this dictionary
  (`tests/analytics.test.ts` checks that each event is here).

## Loading

GA loads only when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set and `VERCEL_ENV` is `production` or `preview`,
never in development or the tests. Previews send with `debug_mode`, so their events show in DebugView and
stay out of the reports. The UI tests turn it on for one browser with the `phean-analytics-test=1` cookie,
honoured only on a server started with `PHEAN_ANALYTICS_TEST_ID` and no `VERCEL_ENV`.

| Variable | Where | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Production and Preview | No |
| `GA_API_SECRET` (Measurement Protocol) | Production only | Yes |
| `ANALYTICS_ID_SALT` (hashes people and workspaces) | Production and Preview | Yes |

The pages' Content Security Policy (`next.config.ts`) sets no `script-src` or `connect-src`, so gtag needs no
change to it. If a `script-src` is ever added, allow `https://www.googletagmanager.com` and, for
`connect-src`, `https://*.google-analytics.com` and `https://*.analytics.google.com`.

GA wrapped the stream's Google tag in a Tag Manager container (`GTM-T8ZX68T5`, "Configure tag settings" on
the stream). Its Google tag must keep `send_page_view` set to `false` and "Ignore duplicate instances of
on-page configuration" unticked (published as version 2): otherwise it sends a `page_view` of its own,
with the unredacted address, before the page's redacted one. Check both after any change there.

## Consent

- Consent Mode v2. Every ad signal (`ad_storage`, `ad_user_data`, `ad_personalization`) is always denied;
  `analytics_storage` is denied by default and granted only on Accept. Google signals and ad
  personalization are off.
- Until someone accepts, no Google script loads and nothing is sent (no cookieless pings).
- The choice is the `phean-consent` cookie (`granted` or `denied`, a year). The bar asks once; "Analytics
  choice" in the site footer and the Analytics card on `/account` ask again. Declining after accepting
  sets gtag's `ga-disable-<id>` switch (nothing more is sent, not even cookieless pings) and deletes the
  `_ga` cookies.
- `/privacy` describes what is sent and how to opt out.
- What only the server sees happen (a sign-up or sign-in through GitHub or Google, a workspace created or an
  invitation accepted by an action that redirects) reaches the next page through the `phean-ga-signal`
  cookie (`lib/analytics-signals.ts`): catalog enums only, ten minutes, set only for a visitor who accepted,
  and read and deleted by `AnalyticsSignals` on `/workspaces` and a workspace's overview.

## Redaction

GA is told the route pattern, never the address (`redactLocation` in `src/lib/analytics-paths.ts`):

- `page_location`, `page_path` and `page_referrer` are the pattern: `/w/acme/tasks/t_123` becomes
  `/w/[slug]/tasks/[id]`, `/invite/abc` becomes `/invite/[id]`, OAuth and sign-in queries are dropped.
  The redacted location, title and referrer are `set` before gtag sends anything and again on every
  navigation before the new page's events, so every event (gtag's own included) reports them. Events a
  page sends before the loader has read the consent cookie wait for it (`flushAnalyticsQueue`).
- App, auth and OAuth pages send the pattern as `page_title` too, since their titles name workspaces and tasks.
- Public pages (landing, docs, blog, privacy) keep their path and only the `utm_*` and `ref` query keys.
  No search term is ever sent, so the stream's site search is off. An unknown top-level path is `/[other]`.
- A referrer from another site is its origin only.
- Outbound clicks are Phean's own `click` event: the URL on public pages; in the app only the registrable
  domain (`acme.slack.com` is `slack.com`), since agents' links and their subdomains can name a customer. GA's enhanced measurement of outbound clicks, file downloads, form
  interactions, video, site search and history-based page changes must stay off in the stream's settings
  (only scrolls stay on): gtag cannot turn them off from code, and each would send raw addresses.
- People and workspaces are `SHA-256(ANALYTICS_ID_SALT:kind:id)`, cut to 32 hex characters, computed on the
  server. No salt, no id. Emails, names, slugs, titles, notes, questions, answers, URLs from the app and
  search terms are never sent.

## Common parameters

Every event carries these (`commonParams`):

| Param | Values |
| --- | --- |
| `surface` | `marketing`, `docs`, `blog`, `auth`, `app`, `oauth` |
| `app_shell` | `web`, `desktop` (`window.pheanDesktop`), `android` (standalone display / TWA) |
| `theme`, `appearance` | App pages only |
| `signed_in` | Boolean |
| `workspace_hash` | Workspace pages |
| `role` | `owner`, `admin`, `member`; workspace pages |

User-scoped properties: `plan` (when plans exist), `signup_method` (set with `sign_up`, on the page and the server copy), `workspace_count_bucket` (`1`, `2-3`, `4+`, on app pages).
`user_id` is the hashed person on signed-in app pages.

Counts are always buckets (`countBucket`: `0`, `1`, `2-3`, `4-9`, `10-24`, `25+`), never exact figures.

## Event dictionary

Key events are marked **key**. "Server" means the Measurement Protocol sends it too (**also**) or only the
server sends it (**only**); server copies carry `source_side=server`, and key-event counts use them.

### Every surface

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `page_view` | Every page load and App Router navigation | `content_group` (the surface), `page_template` (the route pattern), `post_slug` (blog), `doc_slug`, `doc_section` (docs) | | |
| `consent_change` | Someone accepts, or withdraws, analytics | `analytics` (`granted`, `denied`) | | |
| `click` | An outbound link is followed | `outbound`, `link_domain`, `link_url` (public pages only) | | |

### Marketing site

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `cta_click` | A primary or secondary call to action is clicked | `cta_id` (`hero_open_phean`, `hero_create_workspace`, `hero_see_decisions`, `hero_connect_agent`, `nav_open_phean`, `nav_get_started`, `nav_sign_in`, `footer_*`, `section_*`; the `data-cta` attributes), `location` (`hero`, `nav`, `section:<id>`, `footer`) | | |
| `section_view` | A landing section is half visible, once per page view | `section_id` | | |
| `demo_interact` | The boulder card in the "Why Phean" hill scene is answered, or the handoffs section's server window opened or paused | `demo` (`boulder`: `decide_now`, `hold_week`; `handoff_relay`: `hover_server`, `open_tooltip`, `pause`, `play`), `action` | | |
| `docs_nav` | A link from the marketing site into the docs | `target` (doc slug) | | |

### Docs

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `docs_copy` | Text is copied from a docs code block or inline code (the docs have no copy buttons; the text is classified in the browser and never sent) | `doc_slug`, `block` (`code`, `mcp_url`, `install_command`, `prompt`), `lang` | | |
| `docs_search` | The docs are searched (not sent: the docs have no search yet) | `results_count` | | |
| `docs_feedback` | A "was this helpful" answer (not sent: there is no such control yet) | `doc_slug`, `helpful` | | |
| `skill_install_click` | A skill's install command or path is copied from the docs | `skill` (`phean-decisions`, `phean-handoffs`, `phean-pipelines`, `phean-webhooks`, `phean-documents`) | | |
| `client_setup_view` | A client's setup page is viewed, or its section on Connect an agent is opened by its anchor | `client` (`claude_code`, `claude_desktop`, `cursor`, `vscode`, `chatgpt`, `other`) | | |

### Auth and onboarding

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `sign_up_start` | The sign-up page is viewed | | | |
| `sign_up` | An account is created | `method` (`password`, `github`, `google`) | **key** | also |
| `login` | Someone signs in | `method`, `two_factor` | | |
| `two_factor_challenge` | The two-factor step is shown, passed or failed | `result` (`shown`, `passed`, `failed`) | | |
| `workspace_create` | A workspace is created | | **key** | also |
| `invite_send` | An invitation is sent | `role` | | |
| `invite_accept` | An invitation is accepted | `role` | | |
| `onboarding_step` | A step of the empty workspace's flow is done | `step` (`connect_agent_viewed`, `mcp_url_copied`, `first_task_seen`) | | |

### App: agents

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `agent_connect_start` | The OAuth dialog opens | `client_hint` (the client's name bucketed to `KNOWN_CLIENTS`) | | |
| `agent_connect_approve` | A person approves an agent | `level`, `lifetime_days`, `reconnect`, `took_over_work`, `client_hint` | **key** | also |
| `agent_connect_deny` | A person denies an agent | | | |
| `agent_revoke` | An agent is revoked | `is_subagent` | | |
| `agent_key_issue` | A fixed key is issued | | | |

### App: decisions

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `decision_view` | The Decisions page is viewed | `pending_count_bucket` | | |
| `decision_answer` | A person answers a request | `via` (`page`, `inbox`, `notification`, `desktop`, `pipeline_card`, `quick`), `kind` (`decision`, `question`), `with_options`, `multiple`, `custom_answer`, `is_pipeline`, `first_answer` (the person's first answer in this workspace, from the server; a person-wide count would read across workspaces), `gesture` (Quick Decisions only: `swipe`, `tap` on an option or Send, `dock` in the full context, `composer` for a written answer, `keyboard`) | | also (answers from a notification or the desktop app, which no page sees) |
| `first_decision_answer` | Sent beside a `decision_answer` whose `first_answer` is true, from the same side (`derivedEvents`): GA's own derived events cannot test a parameter | `via` | **key** | also (beside the server's `decision_answer`) |
| `decision_snooze` | A request is snoozed | `gesture` (Quick Decisions only: `swipe`, `button`, `keyboard`) | | |
| `decision_undo` | An answer is taken back | | | |
| `decision_mark_answered` | A request is marked answered | | | |
| `quick_decisions_open` | Quick Decisions opens | `from` (`button` on the Decisions page, `phone` from its phone banner, `link` from anywhere else) | | |
| `quick_context_open` | A request's full context opens in Quick Decisions, or another of its tabs is chosen | `tab` (`context`, `files`, `links`) | | |
| `quick_file_open` | A request's file opens in Quick Decisions' file viewer | | | |
| `quick_decisions_done` | Quick Decisions runs out of requests and shows its done screen | `answered_bucket` (answered in this session, as `countBucket`) | | |
| `quick_snoozed_rest` | Quick Decisions comes round to the requests snoozed in this visit, with nothing else waiting, and rests on its snoozed screen | `snoozed_bucket` (snoozed requests left, as `countBucket`) | | |
| `quick_snoozed_show` | Show snoozed again, on that screen | | | |

### App: tasks, search, goals

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `task_create_manual` | A person adds a task or goal by hand | `as` (`task`, `goal`) | | |
| `task_move` | A task changes lane | `from_kind`, `to_kind` (task status kinds), `via` (`drag`, `button`; `keyboard` once the board has a keyboard move) | | |
| `task_done` | Done | | | |
| `task_drop` | Drop | | | |
| `task_undo` | A task action is undone | | | |
| `task_hand_off` | A person hands a task off | `to` (`agent`, `person`, `anyone`), `hand_back` | | |
| `task_take` | A person takes a task | | | |
| `task_release` | A person releases a task | | | |
| `task_peek_open` | A task opens in the peek | `from` (`board`, `table`, `calendar`, `map`, `search`, `decisions`, `goals`, `other`) | | |
| `task_open_page` | A task opens as a full page | | | |
| `tasks_layout` | The Tasks page's layout changes | `layout` (`board`, `table`, `calendar`, `map`) | | |
| `filter_apply` | A toolbar filter is applied | `filter` (`goal`, `status`, `kind`, `operator`, `stuck`) | | |
| `search_submit` | A workspace search is run (never the term) | `has_results`, `used_suggestion`, `from` (`shortcut`, `click`) | | |
| `goal_create` | A goal is created | | | |
| `goal_decide` | A goal is approved, rejected, achieved or abandoned | `decision` (`approve`, `reject`, `achieved`, `abandon`) | | |
| `goal_open` | A goal's page opens | | | |

### App: pipelines

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `pipeline_create` | A pipeline is created | `kind`, `template` (or `blank`), `stops_count`, `has_person_stop`, `has_fork`, `has_choice`, `created_by` (`person`, `agent`) | **key** | also (an agent's comes only from the server) |
| `pipeline_save_version` | A new version is saved | `stops_count` | | |
| `pipeline_tab` | A pipeline's tab opens | `tab` (`map`, `runs`, `insights`, `definition`) | | |
| `run_start` | A run starts | `trigger` (`manual`, `agent`, `schedule`, `event`, `webhook`) | | also (non-manual ones come from the server) |
| `run_cancel` | A run is cancelled | | | |
| `run_rerun_from` | A run is rerun from a stop | | | |
| `run_rename` | A run is renamed, or its name cleared (never the name) | | | |
| `handoff_resend` | A person resends a stop's handoff to the agent it waits on | `stuck` | | |
| `run_view` | A run's view changes | `view` (`compact`, `timeline`, `activity`) | | |
| `proposal_decide` | An agent's proposed change is decided | `result` (`approve`, `reject`) | | |
| `pipeline_pause` | A pipeline is paused | | | |
| `pipeline_resume` | A pipeline is resumed | | | |
| `pipeline_archive` | A pipeline is archived | | | |
| `trigger_edit` | A pipeline's trigger is changed | `trigger_type` | | |

### App: documents, memory, navigation, settings

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `document_open` | A document opens | `format` (`markdown`, `html`, `file`) | | |
| `memory_search` | Memory is searched (never the term) | `has_results` | | |
| `tab_open` | A workspace tab is opened | `tab` (a `WORKSPACE_PAGES` key) | | |
| `copy_link` | An item's link is copied | `kind` (by id prefix) | | |
| `keyboard_shortcut` | A keyboard shortcut is used | `shortcut` (the legend's action name) | | |
| `resume_session_click` | The way back into an agent's session is used | `kind` (`link`, `popover`) | | |
| `theme_change` | The colour theme changes | `theme` | | |
| `appearance_change` | Light, Dark or System changes | `appearance` | | |
| `push_enable` | Notifications are turned on for a device | | | |
| `push_disable` | Notifications are turned off | | | |
| `two_factor_enable` | Two-factor is turned on | | | |
| `account_link` | GitHub or Google is connected to the account | `provider` | | |
| `workflow_save` | The board's stages are saved | `stages_count` | | |
| `webhook_view` | A webhook's details are viewed (not sent yet: webhooks show only as a cell on the Agents page) | | | |

### Server only (Measurement Protocol)

Agents act over MCP with no page, so the server sends these, after the change commits, never awaited and
never throwing (`sendServerEvents`), and at most 60 a minute per workspace per server process. They are
sent only from production. They carry `workspace_hash` and never name a person: the server cannot know
whether a person accepted analytics, so there is no `user_id`, and the client id is `srv.<workspace hash>`
(or a random one for an event with no workspace, a sign-up). /privacy discloses them as workspace activity.

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `agent_first_call` | A newly approved agent's first MCP call | `client_hint`, `level` | | only |
| `agent_active_day` | An agent's first MCP tool call of the UTC day (once per agent per day, `agents.last_active_day`) | `tools_used_bucket` (not sent yet: the day's count is unknown at its first call) | | only |
| `decision_ask` | An agent asks a person | `kind`, `with_options`, `is_pipeline` | | only |
| `task_capture` | Agents capture tasks | `count_bucket`, `source` | | only |
| `hand_off` | An agent hands work to an agent or a person | `to` | | only |
| `run_end` | A pipeline run ends | `outcome` (`done`, `failed`, `cancelled`), `duration_bucket` | | only |

`sign_up`, `workspace_create`, `agent_connect_approve`, `pipeline_create`, `run_start` (not manual) `decision_answer` (notifications and the desktop only) and its `first_decision_answer` have server copies too (above).

A key event that both the page and the server send counts twice in GA's standard key-event totals. Count those with `source_side = server` (the server copies), and use the page copies for funnels and paths, which need the session.

## Custom definitions in GA

Event-scoped dimensions: every string and boolean param above (`surface`, `app_shell`, `theme`,
`appearance`, `signed_in`, `workspace_hash`, `role`, `page_template`, `post_slug`, `doc_slug`,
`doc_section`, `cta_id`, `location`, `section_id`, `demo`, `action`, `target`, `block`, `lang`, `helpful`,
`skill`, `client`, `method`, `two_factor`, `result`, `step`, `client_hint`, `level`, `reconnect`,
`took_over_work`, `is_subagent`, `pending_count_bucket`, `via`, `kind`, `with_options`, `multiple`,
`custom_answer`, `is_pipeline`, `first_answer`, `gesture`, `answered_bucket`, `as`, `from_kind`, `to_kind`, `to`, `hand_back`, `from`,
`layout`, `filter`, `has_results`, `used_suggestion`, `decision`, `template`, `has_person_stop`,
`has_fork`, `has_choice`, `created_by`, `tab`, `trigger`, `view`, `trigger_type`, `format`, `shortcut`,
`provider`, `analytics`, `tools_used_bucket`, `count_bucket`, `source`, `outcome`, `duration_bucket`,
`source_side`).

Event-scoped metrics: `lifetime_days`, `stops_count`, `stages_count`, `results_count`.

User-scoped dimensions: `plan`, `signup_method`, `workspace_count_bucket`.

GA's standard property limit is 50 event-scoped custom dimensions, so the ones registered are those the
reports use (listed in the property); the rest are still in the raw events and in DebugView.

## Reports (GA Explore)

1. **Acquisition funnel** (closed, by session source and medium): marketing `page_view`, `cta_click`,
   `sign_up`, `workspace_create`, `agent_connect_approve`, `first_decision_answer`.
2. **Docs engagement**: docs pages by views, engagement time and `docs_copy`; docs to sign-up paths; top
   `client_setup_view` clients; Search Console queries to docs pages.
3. **Activation and retention**: cohorts by first `workspace_create` week, returning on `decision_answer`
   or `task_move`; weekly active users by `app_shell`.
4. **Feature adoption**: events per user for decisions, handoffs, pipelines, layouts and search; a
   free-form table by `page_template`.
5. **Agents**: `agent_connect_approve` by `client_hint` and `level`; the `agent_active_day` trend;
   `decision_ask` against `decision_answer`.
6. **Pipelines**: created by kind and template, runs by trigger, `run_end` outcomes.
7. **Marketing**: `section_view` reach per section, `demo_interact`, `cta_click` by `cta_id` and `location`.

The Library has two collections, "Product" and "Marketing", holding these.
