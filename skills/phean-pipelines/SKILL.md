---
name: phean-pipelines
description: How to define, run and work Phean pipelines, the planned routes of handoffs between agents and people. Use whenever you are connected to a Phean MCP server and work should follow the same steps every time (a weekly newsletter, lead follow-up, release notes), one job should be split between a few agents and people in order, a task handed to you came from a pipeline, or someone asks where a run stands. Covers the definition (stops, next, fork, choice, join, ends, inputs, templates, time limits, failure rules), person stops and their decisions, starting and following runs, cancelling and rerunning, triggers, and proposing changes to a regular pipeline.
---

# Pipelines in Phean

A pipeline is a line on Phean's transit map: a named route of **stops**, each served by an agent, a sub-agent or a person, that work rides along by handoff. Each **run** is one trip down the line. Phean runs it, with no model in the loop: the run gets a task of its own, and each stop a subtask of it as the run reaches it, handed off by name to whoever serves the stop. When that subtask is completed, Phean takes its result to the next stop.

Use one when the same handoffs happen again and again (`regular`), or when one job should be split between a few actors in order (`adhoc`, which starts its run at once and is archived when it ends). For a single handoff, use `hand_off_task` instead (see the phean-handoffs skill).

## When a stop arrives for you

A stop meant for you arrives like any handoff: `list_tasks` with `claimed` set to `handed_to_me` lists it, and a webhook or the realtime stream hears `handed_to_you`. Its `handedOffBy` is the workspace's pipelines agent, and the activity reads as the pipeline's name.

1. `claim_task` it. Read the `delegationNote` and the task's description: they carry the stop's instructions, what to hand on, and the results (and document ids) of the stops before it.
2. Do the work. Attach what you produce to the task with `attach_document`: the documents on the task go to the next stop with your result.
3. Finish with `complete_task` and your result as the `note`. **Do not hand it on yourself**: Phean takes the result to the next stop. Handing it back with `hand_off_task` and `handBack: true` finishes it the same way, with your note as the result.
4. If the note says "Start your note with one of …", the stop is followed by a choice: begin your note with one of those labels ("approved: the numbers check out"). The label picks the branch the run takes; a note that names none fails the stop.

Cannot do it? `release_task` with a note on why. The stop fails, and its failure rule says what happens: it is handed again (to you, as a new attempt), handed back to the stop before it with your reason, put to a person, or the branch fails.

## Defining a pipeline

`define_pipeline` takes a `name`, a `kind` (`regular` or `adhoc`), a `description`, the `definition`, and optionally `triggers` and a `run` to start at once. Phean checks the whole definition and reports every problem at once, in words: fix them all and call again.

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
  "triggers": { "schedule": { "cron": "0 9 * * 1", "timeZone": "Europe/Berlin" } }
}
```

The result carries the pipeline's `url` and its `map` (Mermaid): show the map in a mermaid code block so the person sees the line.

## Person stops

A blocking person stop puts a decision on its subtask, asked by the pipeline itself, with the stop's options. It shows on the person's Decisions page, marked as the pipeline's, and their answer picks the branch. Only the named person, or someone with the role, may answer. Never answer it for them, and never `collect_answers` it: Phean acts on it. With `approvals` above 1, the decision is asked again until enough people pick one option. An advisory stop (`blocking` false) hands the person the subtask with the note, and the run goes on.

## Running and following

- `start_run` with `pipelineId` and `inputs` (by name). Pass `taskId` to run on an existing task: its stops become its subtasks, so it must not be a subtask itself. Pass `goalId` to file the run's own task under a goal. The result has a `headline` ("At Draft the newsletter", "Waiting on Dana at Approve the draft").
- `get_run` shows every stop in order with its `state`: `upcoming`, `active`, `waiting` (on a person), `done`, `failed`, `skipped` (a choice took another branch), `not_reached` (what it waited on cannot arrive), `cancelled`; with its task, result, attempt and who it waits on. A run is never failed while a branch is alive.
- `list_runs` lists runs, newest first; `list_pipelines` and `get_pipeline` show the pipelines.
- `cancel_run` with a `reason` stops a live run and drops its open tasks.
- `rerun_from` with `runId`, `stopId` and a `note` runs a stop again, and every stop after it, on fresh subtasks; a run that ended or failed runs again.
- Webhooks and the realtime stream carry `pipeline.run_started`, `pipeline.stop_reached`, `pipeline.stop_completed`, `pipeline.stop_failed` and `pipeline.run_ended` under the `pipelines` topic, and under `tasks` when you follow the run's task (you do, if you started it).

## Triggers

A regular pipeline can also start runs on its own: a `schedule` (`cron`, at most once an hour, in a `timeZone`), `events` (a task captured with a `tag`, from a `source`, or both; the run gets the inputs `task_id`, `task_title` and `task_description`), or a `webhook` (POST to its trigger URL with the secret, shown once when it is turned on; never put the secret in chat, a task or a document).

## Changing a pipeline

`update_pipeline` with the whole new `definition` makes a new version; runs under way keep the version they started on. An ad hoc pipeline changes at once. A regular pipeline is its owner's or an admin's to change: from you, the change becomes a proposal, so give a `reason` (what it improves). Tell the person in one line that a proposal waits, with the pipeline's `url`. Its triggers stay with people.
