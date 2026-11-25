---
name: phean-pipelines
description: How to design, define, change, run and work in Phean pipelines, the planned routes of handoffs between agents and people. Use whenever you are connected to a Phean MCP server and work should follow the same steps every time (a weekly newsletter, lead follow-up, release notes), one job should be split between a few agents and people in order, someone asks you to build or change a pipeline, a task handed to you came from a pipeline, or someone asks where a run stands. Covers designing a good line, the definition (stops, next, fork, choice, join, ends, inputs, templates, time limits, failure rules), person stops and their decisions, starting and following runs, cancelling and rerunning, triggers, editing a pipeline (a new version, or a proposal a person approves), and what is left to people.
---

# Pipelines in Phean

A pipeline is a line on Phean's transit map: a named route of **stops**, each served by an agent, a sub-agent or a person, that work rides along by handoff. Each **run** is one trip down the line. Phean runs it, with no model in the loop: the run gets a task of its own, and each stop a subtask of it as the run reaches it, handed off by name to whoever serves the stop. When that subtask is completed, Phean takes its result to the next stop.

Use one when the same handoffs happen again and again (`regular`), or when one job should be split between a few actors in order (`adhoc`, which starts its run at once and is archived when it ends). For a single handoff, use `hand_off_task` instead (see the phean-handoffs skill).

Three ways you meet pipelines:

- **Working in one**: a stop is handed to you. See "When a stop arrives for you".
- **Building or changing one**: a person asks for a repeatable flow, or you see the same handoffs happen again and again. See "Designing a pipeline", "Defining a pipeline" and "Changing a pipeline".
- **Running and following one**: you start runs, or someone asks where a run stands. See "Running and following".

## When a stop arrives for you

A stop meant for you arrives like any handoff: `list_tasks` with `claimed` set to `handed_to_me` lists it, and a webhook or the realtime stream hears `handed_to_you`. Its `handedOffBy` is the workspace's pipelines agent, and the activity reads as the pipeline's name.

1. `claim_task` it right away, even before you start: claiming is how Phean knows you got it. **Acknowledge by claiming the stop; until you do, Phean resends the handoff with backoff for up to 3 days** (3, 6, 12, 24 … minutes after the handoff), each time as `task.handoff_retried` with the reason `handed_to_you`, `retry: true`, a `retryCount` and the `reason` it was sent again ("not picked up 12 minutes after the handoff", or "resent by Dana" when a person pressed Resend). After 3 days, or once you can no longer act, it stops and the stop shows as stuck for a person. Releasing, completing or handing the task on ends the resends too. A resend repeats the handoff; do the work once, and de-duplicate by the task id. Read the `delegationNote` and the task's description: they carry the stop's instructions, what to hand on, and the results (and document ids) of the stops before it.
2. Do the work. Attach what you produce to the task with `attach_document`: the documents on the task go to the next stop with your result.
3. Finish with `complete_task` and your result as the `note`. **Do not hand it on yourself**: Phean takes the result to the next stop. Handing it back with `hand_off_task` and `handBack: true` finishes it the same way, with your note as the result.
4. If the note says "Start your note with one of …", the stop is followed by a choice: begin your note with one of those labels ("approved: the numbers check out"). The label picks the branch the run takes; a note that names none fails the stop.

Someone else should do it? `hand_off_task` it to them without `handBack`: the stop stays live, and finishes when they complete it. Need a fact or a sign-off from a person to do the stop? `request_input` on the stop's task, as for any task (see the phean-decisions skill); the run waits with you.

Do not change the run's other tasks: the run's own task and the other stops' subtasks are Phean's to move. Do not capture subtasks under the run's task either; attach your work to your stop's task.

Cannot do it? `release_task` with a note on why. The stop fails, and its failure rule says what happens: it is handed again (to you, as a new attempt), handed back to the stop before it with your reason, put to a person, or the branch fails.

## Designing a pipeline

Before you call `define_pipeline`:

1. **Check it does not exist.** `list_pipelines` first; changing an existing pipeline beats a near-copy.
2. **Agree the line with the person.** Write it out in a few lines (stops, who serves each, where a person decides, how it ends) and ask before defining a regular pipeline: it will run again and again in their name. An ad hoc one, splitting a job they just gave you, needs no extra ask.
3. **Name actors that exist.** An agent stop names an agent or sub-agent of this workspace, exactly as it is called (your own name is in `whoami`); a person stop names a member by email. Phean refuses names it cannot find. Unsure who will do it? Use `any_agent`, or ask.

Then shape it:

- **One actor, one outcome per stop.** "Research", "Draft", "Approve", "Send", not "Research and draft". A stop that two actors share is two stops.
- **Instructions are a handoff note** someone reads cold: what to do, where the inputs are (`{{input.<name>}}`, `{{stops.<id>.result}}`), and what to hand on. Fill `outputs` so the next stop knows what arrives.
- **People decide; agents do.** Put a person stop only where a person must choose or sign off, give it short `options` (or let a choice's labels fill them), a `timeLimitMinutes` and an `onTimeout` so a quiet week does not hold the line forever. Use `blocking` false when they only need to know.
- **Branch on results with a choice.** An agent stop followed by a choice must start its note with a label; say so in its instructions, and set a `default` when one outcome is the usual.
- **Fork only for work that is truly independent**, and say at the join whether it needs `all` branches or the `first`.
- **Plan for failure.** `retry` for flaky work (fetching, sending), `hand_back` when the stop before can fix the input, `ask` when a person should judge, `fail` when nothing can help.
- **Keep it short.** Three to seven stops reads at a glance on the map; more usually means two pipelines.

After defining it, show the person the `map` and the `url`. For a regular pipeline, `start_run` once by hand (or pass `run`) and follow it with `get_run` before you add triggers, so the first trip that runs on its own is not the first one ever.

## Defining a pipeline

`define_pipeline` takes a `name`, a `kind` (`regular` or `adhoc`), a `description`, the `definition`, and optionally `triggers` and a `run` to start at once (give it a `name` too, as for `start_run`). Phean checks the whole definition and reports every problem at once, in words: fix them all and call again.

A definition has `inputs`, `stops` and `ends`, and a `start` (the first stop unless named).

Each stop has:

- `id` (lowercase letters, digits, underscores) and `name`;
- `kind`: `agent` (with `agent`: the agent's or sub-agent's name or id), `person` (with `person`: an email or user id, or `role`: `admin` or `member`), or `any_agent` (whoever picks it up). `pipeline` is reserved for factories and refused for now;
- `instructions`: the handoff note. It may read `{{input.<name>}}`, `{{stops.<id>.result}}` and `{{stops.<id>.answer}}` of a stop before it, `{{run.number}}` and `{{pipeline.name}}`;
- `outputs`: what it should hand on ("a draft document", "the PR link");
- `timeLimitMinutes`: how long it may take;
- `onFailure`: `action` is `retry` (up to `times`), `hand_back` (to the one stop before it, up to `times`), `ask` (a `person` or `role`, the pipeline's owner by default, decides whether to retry), or `fail` (the default);
- `join`: where branches meet, `all` (the default) waits for every live branch, `first` goes on with the first to arrive and cancels the rest;
- `then`: exactly one of `next` (a stop), `fork` (stops that all run side by side), `choice` (branches, each a `label` with `to` a stop or `end` an end, and a `default` label for a result that names none), or `end`.

Person stops also take `options` (filled from the choice's labels when left out), `blocking` (false makes it advisory: the person is told, and the run goes on), `approvals` (with a role: how many people must pick the same option) and `onTimeout` (the option taken when `timeLimitMinutes` passes; they are reminded half way).

There are no loops. To repeat work, give the stop `onFailure` `retry` or `hand_back`.

```json
{
  "name": "Weekly newsletter",
  "kind": "regular",
  "description": "Research, draft, approve and send the Monday newsletter.",
  "definition": {
    "inputs": [{ "name": "topic", "description": "This week's theme", "required": false }],
    "stops": [
      {
        "id": "research",
        "name": "Research the week",
        "kind": "agent",
        "agent": "Claude",
        "instructions": "Find the five most useful links on {{input.topic}} from this week, with a line on each.",
        "outputs": ["a link list"],
        "timeLimitMinutes": 240,
        "onFailure": { "action": "retry", "times": 1 },
        "then": { "next": "draft" }
      },
      {
        "id": "draft",
        "name": "Draft the newsletter",
        "kind": "agent",
        "agent": "Claude",
        "instructions": "Write issue {{run.number}} from these links: {{stops.research.result}}. Attach the draft as a document.",
        "outputs": ["the draft, as a document"],
        "then": { "next": "review" }
      },
      {
        "id": "review",
        "name": "Approve the draft",
        "kind": "person",
        "person": "dana@example.com",
        "instructions": "Send this week's newsletter as drafted?",
        "timeLimitMinutes": 1440,
        "onTimeout": "Hold",
        "then": {
          "choice": [
            { "label": "Send", "to": "send" },
            { "label": "Needs changes", "to": "revise" },
            { "label": "Hold", "end": "held" }
          ]
        }
      },
      {
        "id": "revise",
        "name": "Revise the draft",
        "kind": "agent",
        "agent": "Claude",
        "instructions": "Dana asked for changes. Revise the draft, then send it.",
        "then": { "next": "send" }
      },
      {
        "id": "send",
        "name": "Send it",
        "kind": "agent",
        "agent": "Grok Bot",
        "instructions": "Send the approved draft to the list and reply with the campaign link.",
        "join": "first",
        "onFailure": { "action": "ask" },
        "then": { "end": "sent" }
      }
    ],
    "ends": [
      { "id": "sent", "name": "Sent" },
      { "id": "held", "name": "Held for next week" }
    ]
  },
  "triggers": { "schedule": { "cron": "0 9 * * 1", "timeZone": "Europe/Berlin" } },
  "run": { "name": "Issue 42: AI agents roundup", "inputs": { "topic": "AI agents" } }
}
```

The result carries the pipeline's `url` and its `map` (Mermaid): show the map in a mermaid code block so the person sees the line.

## Person stops

A blocking person stop puts a decision on its subtask, asked by the pipeline itself, with the stop's options. It shows on the person's Decisions page, marked as the pipeline's, and their answer picks the branch. Only the named person, or someone with the role, may answer. Never answer it for them, and never `collect_answers` it: Phean acts on it. With `approvals` above 1, the decision is asked again until enough people pick one option. An advisory stop (`blocking` false) hands the person the subtask with the note, and the run goes on.

## Running and following

- **Name every run** after the specific thing it makes: `start_run` with `name` ("Issue 42: AI agents roundup", "Acme Q3 renewal email", "Release notes for 3.2"), not "Newsletter run" or the pipeline's name again. The name shows wherever the run does: its page, the runs list, the Decisions page ("Stop 2 of 3 · Issue 42: AI agents roundup"), notifications, and as its task's title. Without one, a run shows as "Weekly newsletter #42". `update_run` with `runId` and `name` renames it (`null` clears it); a rerun keeps it.
- `start_run` with `pipelineId`, `name` and `inputs` (by name). Pass `taskId` to run on an existing task: its stops become its subtasks, so it must not be a subtask itself. Pass `goalId` to file the run's own task under a goal. The result has a `headline` ("At Draft the newsletter", "Waiting on Dana at Approve the draft").
- `get_run` shows every stop in order with its `state`: `upcoming`, `active`, `waiting` (on a person), `done`, `failed`, `skipped` (a choice took another branch), `not_reached` (what it waited on cannot arrive), `cancelled`; with its task, result, attempt and who it waits on. A run is never failed while a branch is alive.
- `list_runs` lists runs, newest first, of one pipeline or all; its `status` `waiting` finds runs held for a person. `list_pipelines` and `get_pipeline` show the pipelines.
- Asked where a run stands? Answer with its `headline`, who it waits on, and its `url`. A paused or archived pipeline starts no runs; tell the person rather than retrying.
- A stop failed or came out wrong? Read its result and attempt in `get_run`, then `rerun_from` that stop with a `note` on what to do differently, or tell the person what failed and ask. Cancel a run only when the trip should not go on at all.
- `cancel_run` with a `reason` stops a live run and drops its open tasks.
- `rerun_from` with `runId`, `stopId` and a `note` runs a stop again, and every stop after it, on fresh subtasks; a run that ended or failed runs again.
- Webhooks and the realtime stream carry `pipeline.run_started`, `pipeline.stop_reached`, `pipeline.stop_completed`, `pipeline.stop_failed`, `pipeline.stop_stuck` (no one picked a handoff up in 3 days), `pipeline.run_renamed` and `pipeline.run_ended` under the `pipelines` topic, and under `tasks` when you follow the run's task (you do, if you started it). A handoff resent to you arrives as `task.handoff_retried` with the reason `handed_to_you`, whatever your topics.

## Triggers

A regular pipeline can also start runs on its own: a `schedule` (`cron`, at most once an hour, in a `timeZone`), `events` (a task captured with a `tag`, from a `source`, or both; the run gets the inputs `task_id`, `task_title` and `task_description`), or a `webhook` (POST to its trigger URL with the secret, shown once when it is turned on, and a body `{ "name": "…", "inputs": { … } }`; never put the secret in chat, a task or a document).

Runs a trigger starts are named for you: an event's run takes the captured task's title, a schedule's run the pipeline's name and the day it was scheduled for, in the schedule's time zone ("Weekly newsletter, 2026-11-30"), and a webhook's run the `name` in its body, if any. Rename one with `update_run` once you know what it makes.

## Changing a pipeline

1. `get_pipeline`: read the current `definition`, `versions`, open `proposals` and triggers. A proposal already waiting? Do not stack another on it; tell the person it waits.
2. Edit the definition you read. Keep the stop `id`s of stops that stay: results, insights and the map follow stops by id, so a renamed id reads as a new stop.
3. `update_pipeline` with `pipelineId`, the **whole** new `definition`, and a `reason` (what it improves, in a line a person reads cold). Name and description can change in the same call. Phean checks the definition as `define_pipeline` does.
4. Read the result:
   - An ad hoc pipeline, or a regular one you may change, gets a new version at once. Runs under way keep the version they started on; new runs take the new one.
   - From you, a regular pipeline's change comes back as a `proposal`: nothing changes until its owner or an admin approves it on the pipeline's page. Tell the person in one line that a proposal waits, with the pipeline's `url`. Its fate shows in `get_pipeline`, and as `pipeline.version_approved` or `pipeline.version_rejected` (with their reason) in the activity and on the `pipelines` topic.
   - A proposal goes stale when the pipeline gets a new version before it is approved: it can only be rejected then. `get_pipeline` again and propose from the current version.

Propose an improvement when runs show the need: the same stop failing again and again, people waiting long at one stop, or a step everyone does by hand between two stops. Say what you saw in the `reason`.

## Left to people

Some moves are people's alone, in the app's Pipelines tab: approving or rejecting a proposal, pausing, resuming and archiving a pipeline, changing a regular pipeline's triggers, and answering a person stop's decision. Ask for them; never work around them.
