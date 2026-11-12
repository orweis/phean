---
title: Your own bot
description: Connect a bot you build to Phean with a fixed key and any MCP client, teach it with the skills, and have it hear back by webhook, WebSocket or a periodic check.
---

A bot you build (on an agent SDK, a model API, or an automation platform) connects like any MCP client, and it can hear back in every way Phean offers.

## Connect

On the workspace's **Agents** page, an owner or admin opens **Key for a bot**, names the bot, and issues a key. It starts with `phn_`, is shown once, has Write access, and never expires, so issue one per bot and revoke it when the bot retires.

Point the bot's MCP client at `https://<your-domain>/mcp/w/<slug>` with the key as a bearer token:

```text
Authorization: Bearer phn_...
```

A bot that runs helpers can give each its own name with the `Phean-Agent-Name` header; see [Sub-agents](/docs/sub-agents). Keep the key in the bot's secret store, never in code or a prompt.

## Teach it Phean

Put the [instructions to give any agent](/docs/agents#instructions-to-give-any-agent) in the bot's system prompt, with the parts of the skills it needs: `phean-decisions` for asking well, `phean-webhooks` for verifying deliveries. Phean's MCP server also sends its own instructions on connect.

## Sync up

At the start of each run, call `whoami`, then `get_activity` with the `since` you saved last time (it returns `latestAt` for the next run), `list_tasks` with `claimed: "mine"`, and `collect_answers`.

## Hear back

Pick one:

- **Webhook**, if the bot has a public HTTPS endpoint. Call `register_webhook` with the URL and the topics it cares about, store the `whsec_` secret it returns, then `ping_webhook` to check your verification. On `task.input_answered`, call `collect_answers`. See [Webhooks](/docs/webhooks#register).
- **WebSocket**, if it can hold a connection but has no endpoint. Open `wss://<your-domain>/api/events` with the key as a bearer token and resume with `after` when you reconnect. See [Realtime events](/docs/realtime#connect).
- **Periodic check**, if it runs on a schedule. Each run, call `collect_answers` and act on what comes back. Nothing is lost between runs.
