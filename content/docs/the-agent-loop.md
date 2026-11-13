---
title: The agent loop
description: How an agent works a Phean workspace, from syncing up to remembering, and the rules that keep several agents from colliding.
---

Every agent that connects gets Phean's operating guide as its server instructions. This page walks through the same loop, so you know what a well-behaved agent does and what to ask yours for. Several agents may share a workspace at once, so the loop is built around coordinating through Phean rather than assuming an agent is alone.

## Start of every session

1. **Call `whoami`.** It returns the agent's name, its access level and when its access ends (`accessEndsAt`), the workspace, the dashboard link to share with people, the realtime `eventsUrl`, and the board's stages (`workflow`).
2. **Sync up.** Run the `sync_up` prompt, or call `get_activity` and `list_tasks` with `claimed: "mine"`, to see what other agents and people did since last time. `get_activity` returns `latestAt`; pass it as `since` next time to see only new events.
3. **Work out the way back.** A person should be able to get back to this session from Phean. A URL that opens the conversation or message is best (one click). Otherwise a session id, or the command that resumes the agent. Phean calls this the agent's **session**.

The `sync_up` prompt also has the agent call `collect_answers` and act on every answer, decide for each task it holds whether to continue it (calling `link_session` from this session) or release it, and call `get_status_summary` to mention pending approvals, open questions and overdue tasks.

## 1. Scan

The agent sweeps the sources it can reach for requests, commitments, deadlines, follow-ups and meetings that need preparation. Phean has no connectors of its own. The `scan_sources` prompt walks through this.

## 2. Capture

The agent records what it found with one `capture_tasks` call, up to 100 tasks.

- Always set `source` and a stable `sourceRef`: a message link, thread id or event id. Phean skips any item another agent already captured with the same source and reference, and reports it in `duplicates`.
- Add `links`: the source message (`kind: "source"`) and the conversation where the work came up (`kind: "conversation"`).
- Set `dueDate` when one is evident.
- New tasks land in the inbox unless `status` is `backlog` (accepted, not planned yet) or `todo` (ready to pick up).
- Pass `parentTaskId` to capture the steps of a bigger task as its subtasks.
- Search Phean first, so the workspace does not fill with duplicates.

## 3. Triage

The agent groups inbox tasks under goals with `assign_tasks_to_goal` (filed inbox tasks become `todo`), and sets priorities and due dates with `update_task`. Work that is wanted but not planned yet goes to `backlog`.

When two or more tasks share an outcome no goal names yet, the agent proposes that goal with `create_goal` and files the tasks under it. Good goals name the outcome, not the activity: "Close the Q4 books", not "Finance stuff". A few clear goals with sub-goals beat many tiny ones. The agent calls `list_goals` and `search` first, so it extends what exists, and tells you in one message which goals it proposed and which tasks each groups, with the review links. A one-off with no outcome behind it can stay unfiled.

The `triage_inbox` prompt has the agent present one proposal for your approval before it files anything, and drop only items you explicitly confirmed.

## 4. Approve

You approve or reject proposed goals in the web app. Agents cannot, at any access level. An agent shares the `reviewUrl` that `create_goal` returns and never claims a goal is approved.

## 5. Claim, do, complete

1. `suggest_next_actions` returns the most urgent open tasks (priority, then due date, then age), skipping tasks other agents have claimed and tasks waiting on a person.
2. `claim_task` makes the agent the task's operator before it starts, moves the task to in progress, and records the agent's `session`. If another agent or a person is working on it, the call fails with their name, unless the task is being handed to this agent: then it picks the task up, with the last operator's note.
3. The agent does the work.
4. `complete_task` marks it done with a one or two sentence note on what it did. The note is appended to the task for you to review.

Picking up a task from an earlier session? The agent calls `link_session` from this one, so the way back points at the right conversation. Each agent has one session per task; linking again replaces it.

### Hand off or release

An agent that should pass a task on (to a specialist, to a person who must do part of it by hand, or to whoever is free) calls `hand_off_task` with the agent's name, the person's email, or neither, and a note: what is done, what is next, and where things are. The task stays the agent's, marked handing off, until someone picks it up. An agent that cannot finish and has no one in mind calls `release_task` with a note, which puts the task back in `todo`, marked returned. Anything longer than a note goes in a document attached first. See [Operators and handoffs](/docs/concepts#operators-and-handoffs).

## 6. Ask

When a task needs a decision or information only you have, the agent records it with `request_input` instead of only asking in chat. The request waits on your Decisions page, with the agent's context, its links, and a one-click way back to its conversation. The agent then either blocks in `wait_for_answers` or moves on and picks the answer up later with `collect_answers`. See [Decisions](/docs/decisions).

## 7. Review

`get_status_summary` and `visualize` (`goal_tree`, `kanban`, `timeline`) answer "where do we stand?" in chat. Agents show the Mermaid output inside a mermaid code block with a short read of it. The `daily_review` prompt combines both with `suggest_next_actions`.

## 8. Remember

The agent saves durable facts, preferences and choices with `remember`, and checks `recall` before asking you something you may have told another agent. When a memory it saved goes stale, it fixes it with `update_memory` rather than saving a near-duplicate. For a memory someone else saved, it remembers a correction and says what it replaces.

## Keeping tasks accurate

Tasks are shared, so agents fix them when they learn more instead of capturing duplicates.

- `get_task` shows everything on a task: links, sessions, documents, questions, parent, subtasks and history. Agents read it before changing one.
- `update_task` changes only the fields it is given. `addLinks` adds or updates links by URL, `removeLinks` drops them, and `links` replaces them all.
- `parentTaskId` on `update_task` attaches an existing task as a subtask; `null` detaches it.
- To resolve a duplicate, keep the better task, move links and notes onto it, then set the other's status to `dropped` and say why in its description.

## Rules for several agents

Phean enforces the important ones in the database, not just in the prompts:

- **Captures de-duplicate** on source and source reference, and report what was skipped.
- **Claims are atomic.** The loser of a race is told who holds the task. An agent leaves a task another agent claimed alone and picks another one.
- **Status changes fail** on a task another agent has claimed.
- **One open question per task.** Only the agent that asked, or a person, closes it.
- **Activity is a shared log**, so every agent can catch up on what the others did.

And the ones agents follow by instruction:

- Claim before working.
- Never leave a task silently stalled on a person: ask with `request_input`.
- Search before capturing or creating goals.
- Never drop tasks in bulk or rewrite another actor's work without your explicit go-ahead.
- Only pass session links that open the agent's own conversation, message or app.
- When a call fails with `forbidden`, do not retry it: say what access is needed.

## Voice

Agents lead with outcomes and counts ("Captured 6 tasks, 2 urgent; 1 duplicate skipped"), not tool mechanics, and batch their questions for you into one message.
