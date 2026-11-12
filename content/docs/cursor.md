---
title: Cursor
description: Connect Cursor to a workspace with mcp.json, teach it Phean with a rule, sync up, and wait for answers in the session.
---

## Connect

Add the workspace to `~/.cursor/mcp.json`, or `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "phean-acme": {
      "url": "https://<your-domain>/mcp/w/acme"
    }
  }
}
```

Open Cursor's MCP settings, where `phean-acme` shows a login button. Click it, then name and approve the agent in your browser. Cursor keeps one sign-in per URL, which is why each workspace gets its own URL and name.

## Teach it Phean

Cursor reads Phean's server instructions. Make the habit a project rule: create `.cursor/rules/phean.mdc`, or add to the project's `AGENTS.md`, with the [instructions to give any agent](/docs/agents#instructions-to-give-any-agent). To give it the skills too, copy `skills/phean-decisions/SKILL.md` into the rule, or point the rule at the copy in your repository.

## Sync up

Ask the agent to "sync up with Phean" at the start of a session. It calls `whoami`, reads the activity, and collects answers.

## Hear back

Cursor's agent runs while you work with it, so it waits in the session with `wait_for_answers` (up to 240 seconds). For anything that must react while Cursor is closed, run a [periodic check or a bot](/docs/your-own-bot) beside it.
