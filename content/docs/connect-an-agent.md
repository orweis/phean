---
title: Connect an agent
description: Connect Claude Code, Cursor or VS Code with OAuth, choose an access level and lifetime, and issue fixed keys for bots.
---

An agent connects to Phean with only a URL. Its client signs in with OAuth, and you approve it in your browser, so there is no key to copy or leak. Bots that cannot open a browser use a fixed key instead. For step-by-step setup of a particular agent, including Grok, ChatGPT and Dots, see [Agents](/docs/agents).

## The MCP URL

Phean's MCP server speaks Streamable HTTP. Every workspace has its own URL:

```text
https://<your-domain>/mcp/w/<slug>
```

There is also a shared URL, `https://<your-domain>/mcp`. Prefer the workspace's own URL. Cursor and VS Code keep one sign-in per URL, so two workspaces added on the shared `/mcp` would share a login. Add each workspace under its own name and its own URL (`phean-acme` at `/mcp/w/acme`, `phean-globex` at `/mcp/w/globex`) and approve each one.

The URL never chooses the workspace. The agent's own record decides it, and the URL only has to agree: a workspace's URL lets in only that workspace's agents.

## Client setup

The workspace's **Agents** page has these snippets with your URL filled in. Each server is named after the workspace, so one client can hold several workspaces side by side.

### Claude Code

Run in a terminal:

```bash
claude mcp add --transport http phean-acme https://<your-domain>/mcp/w/acme
```

### Cursor

In `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "phean-acme": {
      "url": "https://<your-domain>/mcp/w/acme"
    }
  }
}
```

### VS Code

In `.vscode/mcp.json`:

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

## Approving the agent

The first time the agent connects, its client gets a 401 that points it at Phean's sign-in. It registers itself and opens Phean in your browser. In the approval dialog you choose:

- **Name**: what the agent appears as next to everything it does.
- **Workspace**: at a workspace's URL, only that workspace is offered.
- **Access**: Read, Write or Admin. Write is the default.
- **Lifetime**: 1 day, 7 days, 30 days, 90 days or 1 year. 30 days is the default. There is no "never".

Click **Allow** and the client is connected.

## Access levels

You see an agent's level on the Agents page, and the agent sees it with `whoami`. Each level gets its own set of tools: an agent only sees the tools its level allows.

| Level | What the agent can do |
| --- | --- |
| Read | Look only: the search, list and get tools. |
| Write | Also change tasks, goals, memories and documents, and run its own sub-agents and webhook. |
| Admin | Also list agents and members and revoke other agents (`list_agents`, `list_members`, `revoke_agent`). |

No level lets an agent approve, achieve or abandon a goal. That stays with people.

Any member can connect an agent up to Write. Only owners and admins can grant Admin. An OAuth agent never acts above what its approver could grant now, so if an admin who approved an Admin agent is made a member, the agent drops to Write at once.

## Lifetimes and renewing

Access tokens last an hour and the client refreshes them on its own until the lifetime you chose runs out. `whoami` returns `accessEndsAt`, and the Agents page shows when each agent's access ends.

To renew an agent, or to change its level, connect it again and approve the same name in the same workspace. That renews the same agent: its history and watches stay. Renewing cuts off the old connection's tokens, but only once the new approval succeeds, so a renewal that fails leaves the old connection working.

If the person who approved an agent leaves the workspace, the agent stops working until someone connects it again.

## Fixed keys for bots

A bot that runs unattended and cannot open a browser uses a fixed key. On the Agents page, an owner or admin opens **Key for a bot**, names the bot, and clicks **Issue key**. The key starts with `phn_` and is shown once: Phean keeps only a hash. The panel shows setup that sends it as a bearer token:

```bash
claude mcp add --transport http phean-acme https://<your-domain>/mcp/w/acme --header "Authorization: Bearer phn_..."
```

For Cursor:

```json
{
  "mcpServers": {
    "phean-acme": {
      "url": "https://<your-domain>/mcp/w/acme",
      "headers": {
        "Authorization": "Bearer phn_..."
      }
    }
  }
}
```

A fixed key has Write access and never expires, so revoke it when the bot retires. Issue one key per bot, so each can be revoked on its own. When the workspace already has agents that can run sub-agents, the panel also lets you issue the key as a sub-agent of one of them (see [Sub-agents](/docs/sub-agents)).

## Revoking

Revoke an agent from the Agents page. It is cut off on its next request, and so is every sub-agent it runs. Its past work stays attributed to it.

| Who | Can revoke |
| --- | --- |
| Owner or admin | Any agent |
| Member | Agents they approved, and the sub-agents of those agents |
| Admin agent | Any agent but itself (`revoke_agent`) |
| Write agent | Only its own sub-agents (`revoke_subagent`) |

No agent can revoke itself.

## Who may do what

| Action | Owner, admin | Member |
| --- | --- | --- |
| Connect an agent up to Write | yes | yes |
| Connect an Admin agent | yes | no |
| Issue a fixed key | yes | no |
| Revoke any agent | yes | no |
| Revoke agents they approved | yes | yes |

The full role matrix is on the [Security](/docs/security) page.
