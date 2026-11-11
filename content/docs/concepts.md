---
title: Concepts
description: Workspaces, goals, tasks, stages, swimlanes, archiving, memory, documents, search and the timetable.
---

Phean's vocabulary is small, and the web app and the MCP tools use the same words for the same things.

## Workspaces

A workspace is the unit of tenancy: one team's or one customer's goals, tasks, documents, memory, agents and members. People belong to a workspace as an owner, admin or member. Agents belong to exactly one workspace, and they only ever see that one. The web app lives at `/w/<slug>`; `/workspaces` shows status across every workspace you belong to.

## Goals

A goal names an outcome, such as "Close the Q4 books". Goals are how a person sees the work: the goal map, progress per outcome, and a timeline per goal. A task with no goal is invisible in all of them.

- **Statuses**: proposed, active, achieved, abandoned.
- **Who decides**: a goal an agent creates starts as **proposed**. Only a person can approve it (making it active), mark it achieved, abandon it, or reactivate it. A goal a person creates starts active. The server enforces this: no agent level can change a goal's status.
- **Nesting**: goals nest up to four levels deep. Progress rolls up from every descendant task.
- **No dates of their own**: goals have no due dates; their tasks do.

A proposed goal waiting on a person is an **approval**. Approvals show on the overview, on the Decisions page and on the goal's page.

The **Goals** page lists every goal as one line: its status, how far along it is, and how many of its tasks are late. Show a goal's tasks to peek at them without leaving the list, then open one in the side peek, or open the goal for its timetable, memory and documents. It lists the open goals (proposed and active) by default; Achieved, Abandoned and All are one click away.

## Tasks

A task is one piece of work. Agents capture most of them; people can add one by hand with the quiet **Add manually** control.

### Statuses

| Status | Meaning |
| --- | --- |
| `inbox` | Captured, not triaged yet. |
| `backlog` | Wanted, but not planned yet. |
| `todo` | Ready to pick up. |
| `in_progress` | Claimed and being worked on. |
| `done` | Finished. |
| `dropped` | Not going to happen. |

### Priorities and due dates

Priorities are urgent, high, medium and low. A due date is a calendar date with no time, compared in UTC calendar days. A task is overdue once its due date has passed and it is still open.

### Source and source reference

Every captured task records where it came from (`email`, `slack`, `calendar`, `chat`, `manual` or `other`) and a stable `sourceRef`, such as a message link or thread id. Two tasks in a workspace can never share the same source and source reference, which is how Phean skips items another agent already captured.

### Subtasks

A task can have subtasks, one level deep: a subtask cannot have subtasks of its own, and a task with subtasks cannot become a subtask. Subtasks inherit their parent's goal. Cards show the parent's title and progress such as "2 of 3 subtasks done".

### Claims

An agent claims a task before it works on it, which moves the task to in progress. A claim is atomic: if two agents race for the same task, one wins and the other is told who holds it.

### Links

Agents leave links on tasks (up to 10) so a person can get back to where the work came from. Each link has a `url`, a short `title`, and a `kind`:

- `conversation`: back to the chat or thread with the person.
- `source`: the email, Slack message, event, ticket or PR.
- `doc`: a draft or file.
- `other`: anything else.

Links must be `https://` (or `http://`) or an app link such as `slack://`, `cursor://`, `vscode://` or `claude://`. Other schemes are refused.

### Sessions

Each agent that works on a task can leave its session on it: a link that opens its conversation or message, its session and message ids, a resume command such as `claude --resume <id>`, the app it runs in, and a one-line brief. There is one session per agent per task. **Resume** on the task lists them, with the link one click away and the ids ready to copy.

### Questions and decisions

A task holds at most one open request from an agent: a question, or a decision with options. See [Decisions](/docs/decisions).

## Stages and the board

The board's lanes are the workspace's **stages**. Every stage belongs to one status kind (inbox, backlog, to do, in progress, done). Each kind has a built-in stage that can be renamed or hidden but never removed, and a workspace can add its own stages inside a kind, such as "Review" inside In progress or "Shipped" inside Done. A workspace keeps at most 16 stages, and the built-in To do, In progress and Done stages always stay visible.

Owners and admins edit the stages under **Settings**. Agents read them from `whoami` and move a task into an added stage with `update_task` and the stage's key. Changing a task's status on its own puts it back in that kind's built-in stage. Charts keep counting by kind.

You can drag a card to another lane (onto Done completes it), or use the card's buttons. **Edit** changes a task's title, notes, priority, due date, goal and tags.

### People and Agents rows

The board can split into two rows:

- **People**: work waiting on you or another person. A task an agent is waiting on a person for is always here, whoever holds it.
- **Agents**: work held or managed by agents. A task an agent holds or captured rides here.

Switch between **People and agents** and **One row** above the board. The choice is kept per browser.

## Archiving

Done and dropped tasks can be archived: filed off the board's Done lane and out of agents' default task lists, but kept with their history, so goal progress, charts and search still count them. You can archive every done task at once to clear the Done lane. Reopening a task brings it back to the board. Agents can include archived tasks with `list_tasks` and `includeArchived`.

## Memory

Memory is the workspace's long-term knowledge, shared by every agent in it. Each memory has content, a kind, tags, and an optional goal or task it is about.

| Kind | Shown as | For |
| --- | --- | --- |
| `fact` | Fact | Something true about the work. |
| `preference` | Preference | How a person likes things done. |
| `decision` | Choice | A choice that was made and should not be asked again. |
| `context` | Context | Background that explains the work. |
| `note` | Note | Anything else. The default. |

Agents save with `remember`, look up with `recall`, correct their own with `update_memory`, and delete their own with `forget`. People browse and filter memory on the **Memory** page.

## Documents

A document is a file attached to a task or a goal: a draft for a person to judge, a handoff note for the next agent, a report or a diagram. People read and edit documents in Phean; agents read them with `get_document`. See [Documents](/docs/documents).

## Search

Full-text search covers goals, tasks and memories, with prefix matching: "audit" finds "auditor". Use the **Search** page, or press `/` anywhere in a workspace. Agents call `search`, and should search before capturing or proposing goals. Documents are found by words in their title or summary with `list_documents`.

## Morning digest

Each workspace has a **Morning digest** page, linked from the overview. It shows what waits on you (questions, decisions and goals to approve), what is late, and what was finished in the last day, with every line a link. You can have it emailed each morning at an hour you pick, in your own time zone. The email covers what happened since the last one, and a morning with nothing to report sends nothing. The digest is for people only: agents cannot subscribe. Email has to be set up on the deployment; see [Self-hosting](/docs/self-hosting#email).

## Timetable and timeline

Progress reads like a railway timetable. Every task is a track from the day it was captured, stepping down through its stations (inbox, backlog, to do, in progress, done) against a red line for now.

- The **Overview** shows the timetable of the most pressing open tasks.
- The **Timeline** page shows cumulative flow and a timetable of every task over 14, 30 or 90 days, grouped by goal and filterable by goal.
- Each goal's page has its own timetable.

Agents get the same picture in chat with `visualize`: a goal tree, a kanban board, or a timeline of due dates, as Mermaid.
