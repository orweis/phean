---
title: Claude Code
description: Connect Claude Code to a workspace, install Phean's skills, sync up with the sync_up prompt, and hear back by waiting, a periodic run or the WebSocket.
---

Claude Code is the most complete Phean client: it signs in with OAuth, runs Agent Skills, shows MCP prompts as slash commands, and can run headless on a schedule.

## Connect

Add the workspace's MCP URL. Name the server after the workspace, so one Claude Code can hold several:

```bash
claude mcp add --transport http phean-acme https://<your-domain>/mcp/w/acme
```

Start Claude Code, run `/mcp`, choose `phean-acme`, and pick **Authenticate**. Phean opens in your browser. Name the agent, choose its access and lifetime, and click **Allow**. Add `--scope project` to share the server with everyone working in a repository (it is written to `.mcp.json`; each person still approves their own agent).

## Teach it Phean

Phean's server instructions reach Claude Code on their own. For the depth, install the skills into your personal skills folder:

```bash
mkdir -p ~/.claude/skills && cp -r skills/phean-decisions skills/phean-handoffs skills/phean-documents ~/.claude/skills/
```

Add `skills/phean-webhooks` when the agent will build or run a bot. Use `.claude/skills/` inside a project instead to share them with the project. See [Skills](/docs/skills).

To make the habit stick, add a line to the project's `CLAUDE.md`:

```text
Track work in Phean: sync up at the start of a session, claim before you start,
and ask me decisions with request_input rather than only in chat.
```

## Sync up

Phean's prompts appear as slash commands named after the server:

```text
/mcp__phean-acme__sync_up
```

The others are `scan_sources`, `triage_inbox` and `daily_review`. You can also just say "sync up with Phean".

## Hear back

- **In the session.** After `request_input`, Claude Code calls `wait_for_answers`, which holds for up to 240 seconds. Answer on the Decisions page and the session carries on.
- **On a schedule.** Run Claude Code headless from cron or a CI schedule, after you have approved the server once interactively:

  ```bash
  claude -p "Sync up with Phean: collect answers to your requests and act on each one." --allowedTools "mcp__phean-acme"
  ```

  Inside a long session, `/loop` re-runs a prompt on an interval.
- **Over the WebSocket.** A background script beside Claude Code can hold `wss://<your-domain>/api/events` open with a fixed key and wake the agent when an answer lands. [Realtime events](/docs/realtime#a-node-client) has a Node client to start from.
- **By webhook.** Claude Code has no public endpoint of its own. A service built with it registers one; see [Your own bot](/docs/your-own-bot).
