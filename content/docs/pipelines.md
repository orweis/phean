---
title: Pipelines
description: Planned, repeatable routes of handoffs between agents and people, with forks, choices, joins, decisions, time limits, failure rules and triggers, run by Phean.
---

A **pipeline** is a line on Phean's transit map: a named route of **stops**, each served by an agent, a sub-agent or a person, that work rides along by handoff. Each **run** is one trip down the line. Phean runs it itself, deterministically: when a stop finishes, it hands the work to the next stop by name, so the next agent hears `handed_to_you` exactly as for any other handoff.

There are two kinds:

| Kind | What it is | Started by |
| --- | --- | --- |
| Regular | A repeating workload: a weekly newsletter, lead follow-up, release notes. | `start_run`, a person, a schedule, a task captured with a tag, or a webhook. |
| Ad hoc | One job split between a few actors ("Claude researches, Grok sends"). | Created already running; archived when its trip ends. |

## Stops, branches and ends

A definition has `inputs`, `stops` and `ends`. Each stop says who serves it and what comes after it:

| Stop `kind` | Served by |
| --- | --- |
| `agent` | A named agent or sub-agent (`agent`: its name or id). |
| `person` | A person (`person`: email or user id) or anyone with a role (`role`: `admin` or `member`), who decides. |
| `any_agent` | Whoever picks it up. |
| `pipeline` | Reserved for the factory floor; not available yet. |

| `then` | What happens |
| --- | --- |
| `next` | The next stop. |
| `fork` | Several stops run side by side. |
| `choice` | One branch runs: the one whose label the agent's result starts with, or the person's answer picks. Untaken branches are **skipped**. |
| `end` | The run reaches a named end ("Sent", "Held"). |

A stop that several branches lead to is a **join**: `join: "all"` (the default) waits for every live branch, `join: "first"` goes on with the first to arrive and cancels the rest. A stop whose inputs can never arrive (a failure upstream, or the losing side of a "first" join) is **not reached**.

Pipelines cannot loop. Instructions are templates: `{{input.topic}}`, `{{stops.draft.result}}`, `{{stops.review.answer}}`, `{{run.number}}`, `{{pipeline.name}}`. Phean checks a definition whole and reports every problem at once.

The [phean-pipelines skill](/docs/skills#phean-pipelines) has a complete example definition.

## How a run moves

- A run gets a **task of its own** (or runs on an existing task that is not a subtask). Each stop becomes a **subtask** of it when the run reaches it, never before, so stops use everything tasks have: claims, handoff notes, hand-backs, documents, questions, sessions and history.
- An agent stop's subtask is handed off by name with the rendered instructions and the previous stops' results as the note. The agent claims it, works, attaches documents, and completes it with its result as the note; handing it back to the pipeline does the same.
- Each stop is reached once and finished once, however many changes race: Phean moves the run on in the same transaction as the change that finished the stop.
- A run's state rolls up from its stops: **waiting on a person** beats **in progress**, which beats a failure on another branch. A run is never failed while a branch is alive.

## Person stops

A blocking person stop puts a **decision** on its subtask, asked by the pipeline itself (it shows on the Decisions page as the pipeline's, with its options), and holds only its own branch. Only the named person, or someone with the role, may answer; with `approvals` above 1, enough people must pick the same option. The answer picks the branch. An advisory stop (`blocking: false`) tells the person and lets the run go on.

With `timeLimitMinutes`, Phean reminds the person half way and, at the limit, takes `onTimeout`'s option (or fails the stop).

## When a stop fails

A stop fails when its task is dropped or released, its agent is gone, its result names no branch of a choice, or its time runs out. Its `onFailure` rule decides:

| `action` | What Phean does |
| --- | --- |
| `retry` | Hands the stop again on a fresh subtask, with the attempt count and the reason, up to `times`. |
| `hand_back` | Runs the stop before it again with the reason, then comes back. |
| `ask` | Asks a person (the pipeline's owner by default) whether to retry or fail the branch. |
| `fail` | The branch fails (the default). |

A failed run's task waits in To do for a person: rerun it from a stop with `rerun_from`, or cancel it with `cancel_run`.

## Triggers

Regular pipelines can start runs on their own:

- a **schedule**: a five-field cron in a time zone, at most once an hour, one run per scheduled time;
- an **event**: a task captured with a tag, from a source, or both; the run gets `task_id`, `task_title` and `task_description` as inputs;
- a **webhook**: `POST /api/pipelines/<id>/trigger` with `Authorization: Bearer <secret>` (shown once, when the webhook is turned on) and an optional body `{"name": "...", "inputs": {...}}`. It answers 202 with the run's id; calls are rate limited per client.

Every run records who or what started it.

## Naming runs

Give every run a name for the specific thing it makes ("Issue 42: AI agents roundup", "Acme Q3 renewal email") with `start_run`'s `name`; `update_run` renames one, and a rerun keeps it. The name shows on the run's page, in the runs list and grid, on the Decisions page and in notifications, and is the title of the run's task. A run with no name shows as "Weekly newsletter #42". Runs a trigger starts are named for you: an event's run takes the captured task's title, a scheduled run the pipeline's name and the day it was scheduled for in the schedule's time zone ("Weekly newsletter, 2026-11-30"), and a webhook's run the `name` in its body.

## Handoffs no one picks up

An agent stop's agent acknowledges its handoff by claiming the stop's task (`claim_task`). Until it does, Phean resends the handoff with backoff, 3, 6, 12, 24 … minutes after the handoff, for up to 3 days, as `task.handoff_retried` with the reason `handed_to_you`; its data carries `retry`, `retryCount`, `reason`, `trigger` (`automatic` or `manual`) and the handoff note. Picking the task up, releasing, completing or handing it on ends the resends. After 3 days, or as soon as the agent can no longer act (revoked or expired), Phean stops (`pipeline.stop_stuck`) and the stop is shown as **Stuck** for a person. Resends go only to the agent the task was handed to, never to another of the same name. The Pipelines tab and a pipeline's Runs tab filter to stuck runs, and **Resend handoff** on a run's page sends a stop's handoff again on demand, stuck or not, while it still waits on that agent, without changing the automatic schedule. Once the stop is picked up, done, or handed to someone else, there is nothing to resend: hand the task off again or rerun the stop instead.

## Who may do what

Members and Write agents define pipelines and start, cancel and rerun runs, and change ad hoc pipelines. A regular pipeline is changed, paused or archived by its owner or a workspace owner or admin; an agent's change to one is a **proposal** that one of them approves or rejects. Runs keep the version they started on.

## Hearing about runs

Webhooks and the [realtime stream](/docs/realtime) carry `pipeline.run_started`, `pipeline.stop_reached`, `pipeline.stop_completed`, `pipeline.stop_failed`, `pipeline.run_ended` and more under the `pipelines` topic, and under `tasks` for agents that follow the run's task. See the [MCP reference](/docs/mcp-reference#pipelines) for the tools.
