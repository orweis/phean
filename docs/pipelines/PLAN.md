# Pipelines: UX and UI plan

Status: draft for review. Nothing here is built yet. Open questions are marked **Q**.

## The idea in one line

A pipeline is a **line** on Phean's transit map: a named route of **stops** (steps), each served by an
agent, a sub-agent or a person, that work rides along by handoff. Each **run** is one trip down the
line. Forks are **branches**, joins are **interchanges**, a person's stop is a **signal** that holds the
trip until they decide, and (later) a **factory** is the network map that groups lines.

This fits what Phean already is: the app already speaks in stations, lines and a timetable; state is
already carried by line form (dashed while waiting, solid while moving, a dot on arrival, a slash when
dropped); handoffs, hand-backs, `handed_to_you` webhooks and Decisions already exist. Pipelines make
those handoffs **planned, repeatable and visible as a whole**.

## What we learnt from CI/CD and workflow tools

Borrow:

1. **One run, several views.** Default to a compact ordered list (Temporal), with a map (GitLab, Argo) and a
   timeline (Buildkite's waterfall, Phean's own timetable) one click away.
2. **Runs × stops grid** for history (Airflow, Dagster): one row per stop, one column per run, so a stop that
   keeps failing or keeps waiting on a person stands out.
3. **A single inbox for everything waiting on a person** (Airflow 3's Required actions). Ours already exists:
   the Decisions page. Pipeline decisions go there, marked and sorted first.
4. **Human steps carry a typed answer, not just approve/reject**, and the answer can choose the branch
   (Buildkite block fields, Spinnaker judgment inputs, LangGraph typed interrupts). Ours: a decision's options.
5. **A human step holds only its own branch**, not the whole run (Argo suspend), and can be **blocking or
   advisory** (Buildkite block vs input step).
6. **Approver rules on the step**: who (a person, anyone with a role), no self-approval for an agent's own
   output, a timeout with a default outcome and an escalation (Harness, GitHub environments, Airflow).
7. **What the run says while it waits**: "Waiting on Dana" is never shown as failed or stuck (Buildkite
   `blocked_state`, CircleCI's "Needs approval").
8. **Skipped vs not reached**: a branch whose condition was false is *skipped*; a stop whose inputs never
   arrived is *not reached* (Argo's Skipped vs Omitted).
9. **Waiting looks different from working**: dashed and gently animated while waiting, solid while an agent
   works, retry count and next attempt shown (Temporal), "–" for stops not started (Buildkite).
10. **Re-run from a stop**: retry a failed stop and everything after it, or hand it to someone else, without
    starting the trip over (GitHub "re-run failed jobs").
11. **Open at what needs you**: a run page lands on the first stop waiting on you, else the first failure,
    else the live stop (GitHub's log fix).
12. **Child lines as cards beside the parent**, status rolled up from the worst child (GitLab downstream
    cards, Argo CD health), for the factory floor later.
13. **Trends for regular pipelines**: success rate, median and slow (P90) trip time per stop, where people
    wait longest, and a *flaky* mark for a stop that fails and then passes on retry (CircleCI Insights).

Avoid:

1. A human step that silently marks the whole run "blocked", with defaults that differ by how it was written (GitLab).
2. A palette that needs a legend (Airflow's eight hues). Every state is an icon, a word and a line form;
   hue is the last cue, and only the station hues we already have.
3. Dependency lines that cross and imply edges that do not exist (GitLab's DAG view): our map is drawn
   from the definition, left to right, branches stacked, never crossing.
4. A visual editor that is a second source of truth and drifts (Jenkins Blue Ocean): one stored definition,
   which agents write and the UI edits, with the map as its picture.
5. Long silent holds: a waiting person is notified (push, the Decisions page, the digest), reminded, and
   the step times out to a default after a set time. Nothing waits 30 or 90 days unseen.

## Kinds

| | Regular (persistent) | Ad hoc | Factory (planned) |
|---|---|---|---|
| What | A repeating workload: weekly newsletter, lead follow-up, release notes | A one-off split of one job between a few actors | A floor plan grouping regular pipelines |
| Made by | An agent from a description (default) or a person in the editor | An agent, usually mid-conversation ("Claude researches, Grok sends") | A person, later |
| Started by | Schedule, an event, an agent or a person | Created already running | Its pipelines' own triggers |
| Shown | Pipelines tab, with health and trends; its decisions marked on Decisions | On its task (a small line on the task page and card) and in Pipelines under Recent | A network map |
| Review | Runs, the grid, insights, versions and proposed improvements | Light: the trip and its result | Rolled-up health |
| Ends | Never; runs end | When its trip ends; then archived | — |

## Model (proposed)

- **Pipeline**: name, kind, description, owner (a person), status (active, paused, archived), current
  **version**. Regular pipelines keep versions; a run is pinned to the version it started on.
- **Version**: the definition, a small JSON graph:
  - **Stops**: `agent` (a named agent or sub-agent), `person` (a person, or anyone with a role),
    `any agent` (whoever picks it up), and later `pipeline` (start another line, for factories).
    Each has a name, instructions (the handoff note template), what it should hand on (a document, a
    link, fields), a time limit, and what happens on failure (retry, hand back, ask a person).
  - **Edges**: plain (next), **fork** (all branches run), **choice** (one branch, chosen by the previous
    stop's result or a person's answer), and **join** (wait for all, or the first, of the branches).
  - **Ends**: named endings ("Sent", "Dropped by review"); a run can end on any of them.
- **Run**: number, version, trigger (who or what started it), status, start and end, the ending reached,
  and a summary.
  - **Q1**: each stop of a run becomes a real Phean **task**, a subtask of the run's own task (Phean's
    subtasks are one level deep, which fits: run → stops). Stop tasks use everything tasks already have:
    claims, handoff notes, hand-backs, documents, questions, sessions, activity, webhooks. Recommended.
- **Engine**: deterministic, in Phean, no model in the loop. When a stop's task completes (or is handed
  back with a result), the engine works out what is next and **hands it off by name** to the next stop's
  agent or person with the stop's instructions, so the next agent hears `handed_to_you` as today. **Q2**.

## Screens

### 1. Pipelines tab (new, in `WORKSPACE_PAGES`)

- **Regular pipelines** as rows, each with its own small line (stops as dots in their actor marks), a
  **trip strip** of the last 20 runs (a dot per run: done, failed, waiting on a person, running), success
  rate, median trip time, and a signal-coloured count when a run waits on you. Paused ones are quiet.
- **Waiting on you** first: any run of any pipeline holding at a person's stop, with "Decide" buttons that
  open the decision in place.
- **Recent ad hoc** below, compact: title, actors, where the trip is, how it ended.
- Header: `ManualEntry`-style quiet **New pipeline** (most are made by agents), filters by kind, status
  and actor.

### 2. Pipeline page (a line)

Tabs: **Map · Runs · Insights · Definition**.

- **Map**: the line left to right. Stops are stations: actor mark, name, expected time. Branches stack
  below the main line and rejoin at interchanges; a choice shows its labels on the edges ("approved",
  "needs changes"). Person stops are signal-ringed with a person glyph. Hovering or focusing a stop shows
  its instructions, time limit and failure rule. The latest run rides on the map: each stop shows its
  state for that run (see States). A text equivalent lists the stops in order.
- **Runs**: the **grid**, one row per stop and one column per run (newest left), each cell an icon and
  hue for that stop's state with its duration on hover, plus a list view (run, trigger, started, trip
  time, ending, waiting on). Filters: ending, waiting on, version.
- **Insights** (regular only): success rate and trip time over time, per-stop median and P90, where people
  wait longest, flaky stops, cost if agents report it, and **proposed improvements**: an agent can
  propose a new version (an edited definition with its reasons), which a person approves like a goal.
  Approved proposals become the next version.
- **Definition**: the editor (below), the version history with diffs, and settings (owner, triggers,
  notifications, pause).

### 3. Run page (a trip)

- Header: pipeline, run number, version, trigger, state in words ("Waiting on Dana at Review", "Ended:
  Sent"), trip time, and actions (cancel, re-run from a stop).
- Left: the **map with this run's states**. Right: the **selected stop**: its task (operator, delegation
  badge, handoff note in and out, documents, the agent's session to resume, questions and answers) and
  its result. Lands on the stop that needs you, else the first failure, else the live one.
- Below: **Compact** (default: each stop in order, one line each, repeats folded), **Timeline** (the
  timetable we already draw, one track per stop, dashed while waiting) and **Activity** (every event).
- **Re-run from here** on any stop; **hand to someone else** on a stuck stop.

### 4. Person stops, notifications and Decisions

The interface where the human comes in is the heart of this.

- A person stop opens a **decision** on the stop's task (kind "decision", the stop's options; free text
  allowed) with a **Pipeline** badge and the line it is on, and the run's context: what came in,
  links, documents.
- **Decisions page**: pipeline decisions first (pinned group "Pipelines"), each showing where the run is
  ("Stop 3 of 5 · Weekly newsletter #42") and what happens next for each option ("Approve → Grok Bot sends";
  "Needs changes → back to Claude"). Snooze still works but a pipeline decision shows its time limit.
- **Notifications**: push (desktop, Android, web) with the options as buttons where the platform allows,
  the digest, and the tab rail's signal count. A reminder at half the time limit; at the limit, the
  stop's default happens (e.g. "Hold") and the owner is told.
- **Approver rules**: a named person, or anyone with a role (any admin); optionally, more than one must
  agree; an agent never approves its own work.
- **Advisory stops**: a person can be *informed* (an FYI stop that does not hold the trip) or *asked*
  (holds only its own branch).

### 5. On tasks

- A task that is a stop shows a small **line strip** on its page and in the peek: the pipeline, this
  run, the stops before and after it, and where the trip is. Board cards get a small line glyph.
- An ad hoc pipeline is born from a task (often by an agent: "split this between Claude and Grok") and
  its trip shows on that task.

### 6. Editor (Definition tab)

- **Agent first**: describe the pipeline to any connected agent and it defines it over MCP; the
  definition appears for review. People can also start from a template (Research → Draft → Review →
  Send; Triage → Fix → Verify).
- **Structured editor, not a free canvas**: an ordered list of stops (add, reorder, delete), each with
  its actor, instructions, outputs, time limit and failure rule; **Fork here**, **Add a choice**, **Join**
  controls insert branches; the **map preview** beside it redraws live. One stored definition, so what
  agents write and what people edit never drift.
- Saving a running regular pipeline creates a new version; running trips keep their version.

### 7. Factory floor (planned, not in the first build)

A network map of lines on one floor, grouped by area, with handoffs between lines drawn as transfers
(a `pipeline` stop starts another line's run and waits for it, or not). Each line shows its health rolled
up from the worst of its recent runs. The model reserves `pipeline` stops and a `factoryId` now so this
needs no migration of meaning later.

## States

One vocabulary, shown as **icon + word + line form**, with the existing station hues only:

| State | Word | Line form | Hue |
|---|---|---|---|
| Not reached yet | Upcoming | thin, no fill, "–" | quiet (`rule`) |
| Handed off, not picked up | Handing off | dashed | inbox |
| Working | In progress | solid | brand |
| Waiting on a person | Waiting on you / on Dana | dashed, gently pulsing | signal |
| Done | Done | dot on arrival | done green |
| Failed | Failed | broken, × | late red |
| Skipped (branch not taken) | Skipped | dotted | quiet |
| Not reached (inputs never came) | Not reached | dotted, faint | quiet |
| Cancelled | Cancelled | slash | quiet |

A run's state reads from its stops: waiting on a person beats in progress beats failed elsewhere on
another branch; it is never "failed" while a branch is still alive.

## MCP (for agents)

- `define_pipeline` (from a structured definition; returns the map and any problems), `update_pipeline`
  (a new version, or a proposal for regular pipelines), `list_pipelines`, `get_pipeline`.
- `start_run` (with inputs), `get_run`, `list_runs`, `cancel_run`, `rerun_from`.
- Stops are tasks, so agents work them with the tools they already use: `claim_task`, `complete_task`
  (its result goes to the next stop), `hand_off_task` (`handBack`), `request_input`.
- Webhooks: `pipeline.run_started`, `pipeline.stop_reached`, `pipeline.run_ended`, plus the task events
  as today. Skills: a new `phean-pipelines` skill, kept in step with the server by tests.

## Build order (proposed)

1. Model, engine and MCP: pipelines, versions, runs; stops as subtasks; fork, choice and join; person
   stops as decisions; tests (isolation, policy, engine).
2. Pipelines tab, pipeline Map and Runs (list and grid), run page with Compact and Timeline.
3. Decisions integration: pipeline badge and grouping, next-step preview, time limits and reminders,
   push buttons.
4. Editor (structured) and templates; versions; task line strip.
5. Insights and proposed improvements.
6. Factory floor (planned).

## Open questions

- **Q1** Stops as subtasks of a run task (recommended), or separate run-step records?
- **Q2** Does Phean's engine hand off to the next stop automatically when a stop completes (recommended),
  or is the pipeline a guide the agents follow themselves?
- **Q3** Triggers for regular pipelines in the first build: manual and by agent only, or also on a
  schedule, or also on events (a task captured with a tag, a webhook)?
- **Q4** First build scope: steps 1–3 above (model, engine, MCP, the views, Decisions), with the editor,
  insights and factory later?
- **Q5** Who may define and change pipelines: any member and Write agents, or admins and Admin agents?
- **Q6** Naming: "Pipelines" (the familiar word) or "Lines" (Phean's transit language)?
