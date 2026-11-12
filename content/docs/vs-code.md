---
title: VS Code
description: Connect VS Code's agent to a workspace with mcp.json, teach it Phean with instructions, run sync_up as a prompt, and wait for answers in the session.
---

## Connect

Add the workspace to `.vscode/mcp.json`:

```json
{
  "servers": {
    "phean-acme": {
      "type": "http",
      "url": "https://<your-domain>/mcp/w/acme"
    }
  }
}
```

Start the server from the file or the MCP servers list. VS Code asks you to sign in; name and approve the agent in your browser.

## Teach it Phean

VS Code passes Phean's server instructions to its agent. Add the [instructions to give any agent](/docs/agents#instructions-to-give-any-agent) to `.github/copilot-instructions.md` or the project's `AGENTS.md`. Where your VS Code supports Agent Skills, copy Phean's skill folders to where it reads them; [Skills](/docs/skills#other-clients) has the layout.

## Sync up

VS Code lists MCP prompts in chat under the server's name. Run Phean's `sync_up` from there, or ask the agent to "sync up with Phean".

## Hear back

The agent waits in the session with `wait_for_answers`. For work that should react while the editor is closed, add a [periodic check or a bot](/docs/your-own-bot).
