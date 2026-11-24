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

## Consent

- Consent Mode v2. Every ad signal (`ad_storage`, `ad_user_data`, `ad_personalization`) is always denied;
  `analytics_storage` is denied by default and granted only on Accept. Google signals and ad
  personalization are off.
- Until someone accepts, no Google script loads and nothing is sent (no cookieless pings).
- The choice is the `phean-consent` cookie (`granted` or `denied`, a year). The bar asks once; "Analytics
  choice" in the site footer and the Analytics card on `/account` ask again. Declining after accepting
  stops sending and deletes the `_ga` cookies.
- `/privacy` describes what is sent and how to opt out.

## Redaction

GA is told the route pattern, never the address (`redactLocation` in `src/lib/analytics-paths.ts`):

- `page_location`, `page_path` and `page_referrer` are the pattern: `/w/acme/tasks/t_123` becomes
  `/w/[slug]/tasks/[id]`, `/invite/abc` becomes `/invite/[id]`, OAuth and sign-in queries are dropped.
  Every later event on the page (scrolls included) reports the same redacted location.
- App, auth and OAuth pages send the pattern as `page_title` too, since their titles name workspaces and tasks.
- Public pages (landing, docs, blog, privacy) keep their path and only the `utm_*` and `ref` query keys,
  plus `q` on the docs and blog for GA's site search. An unknown top-level path is `/[other]`.
- A referrer from another site is its origin only.
- Outbound clicks are Phean's own `click` event: the URL on public pages, only the domain in the app, where
  links are agents' and may be private. GA's enhanced measurement of outbound clicks, file downloads, form
  interactions and history-based page changes stays off.
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

User-scoped properties: `plan` (when plans exist), `signup_method`, `workspace_count_bucket` (`1`, `2-3`, `4+`).
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
| `cta_click` | A primary or secondary call to action is clicked | `cta_id` (`hero_open_phean`, `hero_connect_agent`, `nav_open_phean`, `nav_sign_in`, `footer_*`, `section_*`), `location` (`hero`, `nav`, `section:<id>`, `footer`) | | |
| `section_view` | A landing section is half visible, once per page view | `section_id` | | |
| `demo_interact` | The hero's boulder prompt is answered, or the handoffs section's server tooltip opened | `demo` (`boulder`, `handoff_relay`), `action` | | |
| `docs_nav` | A link from the marketing site into the docs | `target` (doc slug) | | |

### Docs

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `docs_copy` | A copy button is used | `doc_slug`, `block` (`code`, `mcp_url`, `install_command`, `prompt`), `lang` | | |
| `docs_search` | The docs are searched (only if they have search) | `results_count` | | |
| `docs_feedback` | A "was this helpful" answer (only if the control exists) | `doc_slug`, `helpful` | | |
| `skill_install_click` | An install link for a skill | `skill` (`phean-decisions`, `phean-handoffs`, `phean-pipelines`, `phean-webhooks`, `phean-documents`) | | |
| `client_setup_view` | A client's setup tab or section is opened | `client` (`claude_code`, `claude_desktop`, `cursor`, `vscode`, `chatgpt`, `other`) | | |

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
| `decision_answer` | A person answers a request | `via` (`page`, `inbox`, `notification`, `desktop`, `pipeline_card`), `kind` (`decision`, `question`), `with_options`, `multiple`, `custom_answer`, `is_pipeline`, `first_answer` (the person's first answer ever, from the server) | **key** (the funnel uses `first_answer`) | |
| `decision_snooze` | A request is snoozed | | | |
| `decision_undo` | An answer is taken back | | | |
| `decision_mark_answered` | A request is marked answered | | | |

### App: tasks, search, goals

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `task_create_manual` | A person adds a task or goal by hand | `as` (`task`, `goal`) | | |
| `task_move` | A task changes lane | `from_kind`, `to_kind` (task status kinds), `via` (`drag`, `button`, `keyboard`) | | |
| `task_done` | Done | | | |
| `task_drop` | Drop | | | |
| `task_undo` | A task action is undone | | | |
| `task_hand_off` | A person hands a task off | `to` (`agent`, `person`, `anyone`), `hand_back` | | |
| `task_take` | A person takes a task | | | |
| `task_release` | A person releases a task | | | |
| `task_peek_open` | A task opens in the peek | `from` (`board`, `table`, `calendar`, `map`, `search`, `decisions`, `goals`, `other`) | | |
| `task_open_page` | A task opens as a full page | | | |
| `tasks_layout` | The Tasks page's layout changes | `layout` (`board`, `table`, `calendar`, `map`) | | |
| `filter_apply` | A toolbar filter is applied | `filter` (`goal`, `status`, `kind`, `operator`) | | |
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
| `webhook_view` | A webhook's details are viewed | | | |

### Server only (Measurement Protocol)

Agents act over MCP with no page, so the server sends these, after the change commits, never awaited and
never throwing (`sendServerEvents`). They carry `workspace_hash`, and `user_id` is the hashed person who
approved the agent where there is one. They are sent only from production.

| Event | When | Params | Key | Server |
| --- | --- | --- | --- | --- |
| `agent_first_call` | A newly approved agent's first MCP call | `client_hint`, `level` | | only |
| `agent_active_day` | An agent used MCP today (at most once per agent per UTC day) | `tools_used_bucket` | | only |
| `decision_ask` | An agent asks a person | `kind`, `with_options`, `is_pipeline` | | only |
| `task_capture` | Agents capture tasks | `count_bucket`, `source` | | only |
| `hand_off` | An agent hands work to an agent or a person | `to` | | only |
| `run_end` | A pipeline run ends | `outcome` (`done`, `failed`, `cancelled`), `duration_bucket` | | only |

`sign_up`, `workspace_create`, `agent_connect_approve`, `pipeline_create` and `run_start` have server copies too (above).

## Custom definitions in GA

Event-scoped dimensions: every string and boolean param above (`surface`, `app_shell`, `theme`,
`appearance`, `signed_in`, `workspace_hash`, `role`, `page_template`, `post_slug`, `doc_slug`,
`doc_section`, `cta_id`, `location`, `section_id`, `demo`, `action`, `target`, `block`, `lang`, `helpful`,
`skill`, `client`, `method`, `two_factor`, `result`, `step`, `client_hint`, `level`, `reconnect`,
`took_over_work`, `is_subagent`, `pending_count_bucket`, `via`, `kind`, `with_options`, `multiple`,
`custom_answer`, `is_pipeline`, `first_answer`, `as`, `from_kind`, `to_kind`, `to`, `hand_back`, `from`,
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
   `sign_up`, `workspace_create`, `agent_connect_approve`, `decision_answer` with `first_answer`.
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
