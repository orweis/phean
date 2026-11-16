---
name: phean-handoffs
description: How to pass work between agents and people in Phean without dropping it. Use whenever you are connected to a Phean MCP server and a task should move to someone else (a specialist agent, a person who must do part of it by hand, whoever is free), you cannot finish a task, a task is handed to you, or you find a person or another agent working on something. Covers operators, the delegation states (handing off, picking up, returned), writing the handoff note, picking up a handoff, calling one off, and hearing about handoffs by webhook.
---

# Handoffs in Phean

Work moves between agents and people all day: a triage agent passes an issue to a builder, a builder hands a task to a person for a sign-off only they can give, an assistant gives up on an errand it cannot finish. Phean keeps each of those moves visible, so a task is never orphaned and whoever takes it next knows where it stands.

## Operators

A task's **operator** is whoever is working on it right now: the agent that claimed it with `claim_task`, or a person who took it in Phean. Every task you read carries `operatorType` (`agent` or `user`), `operatorName`, and its delegation.

- Claim a task before you work on it. `claim_task` makes you its operator.
- Leave alone any task another agent or a person is working on. `claim_task`, `update_task` status changes and `complete_task` refuse it, naming who has it. Pick other work, or ask them to hand it to you.
- People may step in on any task. If a person takes over yours, you stop being its operator; you hear about it on the task you follow.

## Delegation

A task's `delegation` says whether a handover is under way. No delegation (null) is the steady state.

| `delegation` | What it means | Ends when |
| --- | --- | --- |
| `handing_off` | The operator is passing it on: to a named agent, a named person, or anyone. It stays the operator's until someone picks it up. | Someone picks it up, or the handoff is called off with `cancel_hand_off`. |
| `picking_up` | A new operator has taken it and is reading the handoff note. | The new operator's first step forward: `link_session`, `request_input`, `update_task`, or `complete_task`. |
| `returned` | The operator let it go with `release_task` and a note; it is back in To do. | Someone claims or takes it. |

Who it is for is `delegateToName` (null means anyone); the note is `delegationNote`.

## Handing a task off

Hand off when someone else should carry the work on:

- a specialist agent does the next part better (a builder after a triage agent, a copywriter after a researcher);
- a person must do part of it by hand (sign, call, approve in a system you cannot reach), which is different from a decision: for a choice or a fact, use `request_input` and keep the task;
- you are out of time or access, and you know who or what should continue.

Call `hand_off_task` with:

- `taskId`;
- `toAgent`: the agent's name, as `whoami`, the Agents page and the activity log show it, or its id; or
- `toPerson`: the person's email, or their user id; or neither, to let anyone pick it up;
- `note`: what is done, what is next, and where things are.

```json
{
  "taskId": "t_8f2k1q",
  "toAgent": "Builder agent",
  "note": "Spec is agreed (see the attached plan). Endpoint and tests are done; pagination is left. The PR is linked on the task. Do not change the response shape: two clients depend on it."
}
```

The task stays yours, marked `handing_off`, until they pick it up, so keep it in a safe state until then: commit your work, link the PR, attach anything longer than a note as a document first (see the phean-documents skill). Handing off again changes who it is for; `cancel_hand_off` keeps it with you. A named agent hears about it at once by webhook or the realtime stream, with the reason `handed_to_you`.

## Linking the work

Every task, document, decision and goal you read from Phean carries a `url` that opens exactly that thing (and `whoami` gives a `linkTemplate` for any id). Use them:

- in the handoff note: link the task's documents, the decision that settled the approach, and any related task, instead of describing where they are;
- in chat: when you hand something off or pick it up, post the task's `url` so the person can follow it ("Handed the launch post to Builder agent: <url>");
- when you report back on work you handed off, link the task, not just its title.

Links open for people who are signed in to the workspace; they never grant access on their own.

## Hearing how it ends

Handing a task off does not end your interest in it. Phean keeps you following it, and every change after that (picked up, updated, a question asked, completed, released) reaches your webhook or realtime stream with the reason `handed_off_by_you`, even if you subscribed to other topics. Without a webhook or a stream, call `list_tasks` with `claimed` set to `handed_off_by_me` (add `status: "done"` for the finished ones) when you sync up. When the work comes back `returned`, or sits in `handing_off` with no taker, decide what happens next: hand it to someone else, take it back with `claim_task`, or tell the person who asked for it. `unwatch` ends the follow once you no longer care.

## Writing the handoff note

Write it for someone with no memory of your session:

- **Done**: what is finished and where it lives (links, documents, branches).
- **Next**: the next concrete step, not "continue".
- **Watch out**: what they must not change, decisions already made and by whom, anything that looks wrong but is deliberate.

Keep it to a few lines; put the long version in a document and say so in the note. Never put secrets, tokens or passwords in a note.

## Picking a handoff up

1. Find work handed to you: `list_tasks` with `claimed` set to `handed_to_me` (tasks handed to you by name, or to anyone). `suggest_next_actions` lists them first, and a webhook or the realtime stream tells you as it happens.
2. Call `claim_task` with your session. You become the operator and the delegation reads `picking_up`; `delegationNote` holds the note.
3. Read the note, `get_task` (links, sessions, earlier answers) and the task's documents before you change anything.
4. Take your first step: `link_session` from your session, then carry on. That ends the pick-up.

A task handed to someone else by name is theirs to take: `claim_task` refuses it, naming them.

## Letting a task go

When you cannot finish and have no one in mind, call `release_task` with a `note` on where it stands. The task goes back to To do, marked `returned`, and the next operator, agent or person, picks it up with your note. Prefer `hand_off_task` whenever you do know who should take it.

## Rules

- One operator at a time: claim before you work, and never work on a task someone else operates unless it is being handed to you.
- Hand off or release; never leave a claimed task silently stalled.
- A handoff is not a question. If you only need a person's choice or a fact, ask with `request_input` and keep the task.
- Tell the person in one line when you hand them a task, with its link, as you would for a decision.
