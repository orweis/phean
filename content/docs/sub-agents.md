---
title: Sub-agents
description: Let workers, specialists and relayed bots act in Phean under their own names, listed under the agent that runs them.
---

If your agent runs workers or specialists that act in Phean, or it is a hub that relays for other bots, let each act under its own name. People then see who did what, and the Agents page lists each sub-agent under its parent.

Sub-agents go one level deep: a sub-agent cannot run sub-agents of its own. An agent can have at most 20 active sub-agents.

There are two ways to make one.

## Detected sub-agents: share the parent's credential

The simplest way needs no new token. The sub-agent uses its parent's credential and names itself. Phean detects each new name as the parent's sub-agent the first time it sees it, and acts as that sub-agent from then on.

There are three ways to give the name:

| How | Where it works |
| --- | --- |
| `actingAs` on a tool call | Every tool takes it. A hub passes it on each call it makes for a bot ("Grok research"). Without it, the work is filed under the parent's own name. |
| `Phean-Agent-Name` header | A sub-agent with its own MCP connection sends it on every request, on a fixed key or a signed-in connection. The realtime stream reads it too. |
| `?agent=Name` on the MCP URL | Fixed keys only, for a client that takes just a URL. A signed-in (OAuth) connection must keep its URL exactly as approved, so it uses the header. |

The fixed-key panel on the Agents page says the same: sub-agents can share the key, each with a `Phean-Agent-Name` header (or `?agent=Name` on the URL), and Phean lists each under the key's agent by that name.

## Sub-agents with their own token

To give a sub-agent a token of its own, one you can revoke without touching the parent's, the parent calls `create_subagent` with a `name` and a one-line `purpose` ("Researches vendors"). It returns the sub-agent, its token and the MCP URL. The token is shown once. Hand it to the sub-agent's MCP connection only; never put it in chat, a task, a memory or a document.

Owners and admins can also issue a fixed key as a sub-agent of an existing agent, from **Key for a bot** on the Agents page.

## How the asker is shown

When a sub-agent asks a person something with `request_input`, the request records the parent it asked through. People read it as "Grok research (via Grok Bot)". The Decisions page names the app the question was asked in only when that is not just the asker's own name, so `session.app` should name where the person reaches the conversation (Slack, Claude, Cursor), never the bot itself.

## Levels

A sub-agent never acts above Write, and never above its parent. Its effective level is the lowest of:

- its own level;
- its parent's effective level;
- for an OAuth agent, what its approver can grant now.

So an Admin agent's workers cannot manage agents. Each tool call is checked against the level of the agent actually acting, so a call made with `actingAs` is held to that sub-agent's level, not the parent's.

A sub-agent's access ends with its parent's: it is live only while its parent is.

## Revoking

- A parent revokes its own sub-agents with `revoke_subagent` when their job is done.
- Revoking an agent revokes every sub-agent it runs, disables their webhooks and cuts off their tokens.
- Revoking a detected sub-agent refuses that name from then on: calls naming it fail.
- A sub-agent's past work stays attributed to it.

People revoke sub-agents from the Agents page. A member can revoke the sub-agents of an agent they approved. See [Connect an agent](/docs/connect-an-agent#revoking) for who may revoke what.
