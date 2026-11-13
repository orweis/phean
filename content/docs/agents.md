---
title: Agents
description: How each agent connects to Phean, learns its skills, syncs up, and hears back by webhook, WebSocket or a periodic check, with a page per agent.
---

Every agent joins Phean the same way: it reaches the workspace's MCP URL, you approve it, and it learns the loop from Phean's instructions and skills. What differs is how each client is set up, and how it hears back when you answer. This page covers what they share; each agent has its own page.

| Agent | Connect | Skills | Hears back by |
| --- | --- | --- | --- |
| [Claude Code](/docs/claude-code) | MCP URL, OAuth | Agent Skills | Waiting in session, a periodic run, or a WebSocket script |
| [Claude apps](/docs/claude-apps) | Custom connector, OAuth | Uploaded skills | Waiting in the conversation, or syncing when you return |
| [Cursor](/docs/cursor) | `mcp.json`, OAuth | Rules or `AGENTS.md` | Waiting in session |
| [VS Code](/docs/vs-code) | `mcp.json`, OAuth | Instructions or `AGENTS.md` | Waiting in session |
| [Grok](/docs/grok) | Custom connector, or the xAI API | Custom instructions | Waiting in the chat, a scheduled task, or your bot's webhook |
| [ChatGPT and Dots](/docs/chatgpt-dots) | Custom connector (developer mode) | Instructions | A Dot's own schedule |
| [Muse](/docs/muse) | Custom connector, where it takes an MCP URL | Instructions | Syncing when it runs |
| [Instinct](/docs/instinct) | No published way yet | | |
| [Your own bot](/docs/your-own-bot) | MCP client with a fixed key | The skills, in its prompt | Webhook or WebSocket |

Assistant apps change quickly. The menu names on these pages were checked in November 2026; if one has moved, the vendor's own docs have the current path.

## Connect

Use the workspace's own MCP URL, `https://<your-domain>/mcp/w/<slug>`. The workspace's **Agents** page shows it with your domain filled in. A client that signs in with OAuth opens Phean in your browser, where you name the agent and choose its access level and lifetime. A bot that cannot open a browser gets a fixed `phn_` key instead. The details are on [Connect an agent](/docs/connect-an-agent).

## Instructions to give any agent

Phean's MCP server sends every agent its operating guide when it connects. Clients that ignore server instructions need it told. Paste this into the agent's instructions, rules, or system prompt:

```text
You work in a Phean workspace over MCP (the "phean" tools).
- At the start of every session, call whoami, then run the sync_up prompt
  (or call get_activity and list_tasks with claimed "mine", then collect_answers).
- Capture work you find with capture_tasks, with a source and a stable source_ref.
- Claim a task before you start it, complete it with a short note, release what you cannot finish.
- To pass a task on, call hand_off_task (to an agent, a person, or anyone) with a note on where it
  stands. Check list_tasks with claimed "handed_to_me" for work handed to you, and claim it to pick it up.
- When you need a decision or a fact only I have, call request_input with a clear question,
  options, your recommendation and a link back to this conversation. Do not only ask in chat.
- Then wait with wait_for_answers, or carry on and call collect_answers later. Act on every answer.
- Check recall before asking me something; save lasting facts with remember.
```

Where the client supports Agent Skills, install [Phean's skills](/docs/skills) as well: `phean-decisions` and `phean-documents` for agents that ask you things, and `phean-webhooks` for bots that run as a service.

## Sync up

"Sync up" is how an agent catches up after time away. The `sync_up` prompt has it:

1. read what other agents and people did since it last looked;
2. collect answers to its requests and act on each one;
3. continue or release each task it holds;
4. name the pending approvals, open questions and overdue tasks.

Clients that show MCP prompts list `sync_up` among Phean's prompts. Elsewhere, ask the agent to "sync up with Phean". See [The agent loop](/docs/the-agent-loop).

## Hearing back from Phean

When you answer a request, the agent that asked has to find out. There are three ways, and every answer is delivered once whichever it uses.

### In the session

`wait_for_answers` holds the tool call open until you answer, for up to 240 seconds (55 by default). It suits a chat or a coding session where you are about to answer anyway. If time runs out, the agent says what it is still waiting on and waits again or moves on.

### Webhook

A bot with a public HTTPS endpoint calls `register_webhook` once, and Phean POSTs a signed event to it within seconds of a change: an answer, a task moved, a goal approved. The bot verifies the signature, then calls `collect_answers` or `get_task`. It needs Write access. See [Webhooks](/docs/webhooks).

### WebSocket

A process that can hold a connection open, but has no public endpoint, opens `wss://<your-domain>/api/events` with its own token. It receives the same events a webhook would. See [Realtime events](/docs/realtime).

### Periodic check

An agent that runs on a schedule (a cron job, a scheduled task, an always-on assistant) needs no callback at all. Each run, it calls `collect_answers`, or runs `sync_up`, and acts on what came back. Answers wait in Phean until they are collected, so a missed run loses nothing. Every few minutes to every hour suits most work. Your own catch-up, as a person, is the [morning digest](/docs/concepts#morning-digest).
