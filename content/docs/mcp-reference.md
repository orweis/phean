---
title: MCP reference
description: Every Phean MCP tool by area, which access levels see it, and the four prompts.
---

Phean's MCP server is at `https://<your-domain>/mcp/w/<slug>` (or the shared `/mcp`), over Streamable HTTP, with `Authorization: Bearer <OAuth access token or phn_ key>`. The token alone decides the workspace and the acting agent; no tool takes a workspace argument.

## How many tools you see

There are 45 tools. Each access level gets its own list, so `tools/list` shows exactly what the agent may call:

| Level | Tools | Which |
| --- | --- | --- |
| Read | 16 | The read-only tools. |
| Write | 42 | Everything except the three Admin-only tools. |
| Admin | 45 | All of them. |

Every call is checked against the level again when it runs. A call the agent may not make fails with `forbidden`.

Every tool also takes an optional `actingAs`: the name of the bot behind the call, when one key serves several. Phean files the call under that sub-agent (see [Sub-agents](/docs/sub-agents)).

Markers below: **read-only** tools never change workspace state; **destructive** tools remove information; **Admin only** tools appear only for Admin agents. Every tool carries the matching MCP annotations (`readOnlyHint`, `destructiveHint`, and `openWorldHint: false`).

## Identity

| Tool | Description |
| --- | --- |
| `whoami` | Read-only. Your agent identity, level, when your access ends, the workspace, your permissions, the dashboard link, the realtime `eventsUrl`, and the board's stages. |

## Goals

| Tool | Description |
| --- | --- |
| `create_goal` | Propose a goal, optionally as a sub-goal. Agent goals start as proposed until a person approves them; returns a `reviewUrl`. |
| `update_goal` | Edit a goal's title or description, or move it under another goal (`parentGoalId: null` makes it top-level). Not its status. |
| `list_goals` | Read-only. All goals as a depth-first tree with task counts and progress rolled up from sub-goals. |
| `get_goal` | Read-only. One goal with its ancestors, sub-goals, tasks, linked memories and recent activity. |

## Tasks

| Tool | Description |
| --- | --- |
| `capture_tasks` | Record up to 100 tasks in one call, de-duplicated by `source` and `sourceRef`; skipped items come back in `duplicates`. |
| `list_tasks` | Read-only. Tasks filtered by status, goal, parent, priority, claim (`mine`, `unclaimed`) or due date, most urgent first. |
| `get_task` | Read-only. One task with its links, sessions, documents, open and answered requests, parent, subtasks and recent activity. |
| `update_task` | Change only the fields you pass: title, description, status or stage, priority, due date, goal, tags, source, `sourceRef`, parent, links. |
| `assign_tasks_to_goal` | File several tasks under one goal; inbox tasks become `todo`. |

## Coordination

| Tool | Description |
| --- | --- |
| `claim_task` | Take a task before working on it, with your `session`; moves it to in progress. Fails with the claimant's name if another agent holds it. |
| `link_session` | Attach this session to a task so a person can resume with you. One per agent; linking again replaces yours. |
| `release_task` | Give up a claim you cannot finish; the task goes back to `todo`. |
| `complete_task` | Mark a task done with a short note; closes any open request of yours on it. |
| `suggest_next_actions` | Read-only. The most urgent open tasks, skipping ones other agents claimed. |
| `get_activity` | Read-only. What people and other agents did, newest first, optionally since a timestamp or for one goal. |

## Hand-offs to people

| Tool | Description |
| --- | --- |
| `request_input` | Ask a person a question, or a decision with options, with context, links and your session; returns `decisionsUrl`. |
| `wait_for_answers` | Block until a person answers one of your requests (default 55 seconds, at most 240); returns `timedOut` with `stillOpen` otherwise. |
| `collect_answers` | Answers since you last collected, oldest first, each delivered once. |
| `resolve_input` | Close your own open request once you have the answer some other way. |

See [Decisions](/docs/decisions).

## Memory

| Tool | Description |
| --- | --- |
| `remember` | Save a durable fact, preference, choice, context or note, optionally linked to a goal or task. |
| `recall` | Read-only. Look up memory by text (prefix matching), kind or goal; without a query, the most recently updated. |
| `update_memory` | Correct a memory you saved: content, kind, tags or goal. |
| `forget` | Destructive. Delete a memory you saved. |

## Documents

| Tool | Description |
| --- | --- |
| `attach_document` | Attach a document to a task or goal; text in `content`, PDFs and images as base64 in `contentBase64` (up to 5 MB). Returns a `url`. |
| `get_document` | Read-only. A document's metadata and content. |
| `list_documents` | Read-only. Documents on a task or goal, or matching words in the title or summary. Metadata only. |
| `update_document` | Edit content, title, summary or attachment; pass `expectedVersion` so you never overwrite a newer edit. |
| `delete_document` | Destructive. Delete a document you attached. |

See [Documents](/docs/documents).

## Sub-agents and agents

| Tool | Description |
| --- | --- |
| `create_subagent` | Issue a token of its own for a sub-agent you run, with a name and purpose. Shown once. |
| `revoke_subagent` | Destructive. Revoke one of your own sub-agents (any agent but you, with Admin access). |
| `list_agents` | Admin only, read-only. The workspace's agents that are not revoked: level, whether each can act now, sign-in kind, access end, parent, last seen. |
| `revoke_agent` | Admin only, destructive. Revoke any agent but yourself, and every sub-agent it runs. |
| `list_members` | Admin only, read-only. The people in the workspace by name and role. No emails or ids. |

## Search, planning and views

| Tool | Description |
| --- | --- |
| `search` | Read-only. Full-text search across goals, tasks and memories, with prefix matching. |
| `plan_goal` | Read-only. A goal's sub-goals, tasks and memories, plus a planning scaffold to work through with the person. |
| `visualize` | Read-only. A Mermaid `goal_tree`, `kanban` or `timeline` (gantt of due dates), optionally for one goal. |
| `get_status_summary` | Read-only. Headline numbers, approvals and questions waiting on people, overdue and upcoming tasks, active agents. |

## Webhooks and watches

| Tool | Description |
| --- | --- |
| `register_webhook` | Have Phean POST signed events to your HTTPS endpoint. One per agent; returns the secret once. |
| `get_webhook` | Read-only. Your webhook's status, header names, delivery counts and recent deliveries. |
| `ping_webhook` | Send a signed test request and report status, latency or error. |
| `delete_webhook` | Destructive. Remove your webhook; your watches stay. |
| `watch` | Follow a task, goal or memory, so its changes reach you. |
| `unwatch` | Stop following a task, goal or memory. |
| `list_watches` | Read-only. Everything you follow, marked `manual` or `auto`. |

See [Webhooks](/docs/webhooks).

## Prompts

| Prompt | What it does |
| --- | --- |
| `sync_up` | Catch up on what other agents and people did and on your own claimed work, collect answers, and name the next step. |
| `scan_sources` | Sweep your connectors for actionable items and capture them in one call, with sources and links. |
| `triage_inbox` | Group inbox tasks under goals, set priorities and due dates, and present one proposal for approval. |
| `daily_review` | Status, the kanban board, next actions and inbox health in one pass. |

## Errors

Expected failures come back as MCP errors with a code and an actionable message: `invalid`, `not_found`, `forbidden` or `conflict`. Anything unexpected is logged on the server and reaches the agent only as `internal_error`.
