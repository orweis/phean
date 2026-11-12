---
title: Grok
description: Connect Grok to a workspace as a custom connector or through the xAI API's remote MCP tools, give it Phean's instructions, and hear back in the chat, on a schedule, or through your bot.
---

Grok reaches Phean two ways: the Grok app's custom connectors, for you in a chat, and the xAI API's remote MCP tools, for a bot you build on Grok.

## Connect in the Grok app

1. On grok.com, open **Connectors**, choose **New connector**, then **Custom**.
2. Paste the workspace's URL, `https://<your-domain>/mcp/w/acme`, and name it after the workspace.
3. Complete the sign-in when Grok asks for it: Phean opens, and you name and approve the agent.

Custom connectors need a paid Grok plan. Turn the connector on in a chat before asking Grok to use Phean.

## Connect through the xAI API

A bot built on the API passes Phean as a remote MCP tool: the tool type `mcp`, the workspace's URL as its server URL, and a fixed `phn_` key as its authorization, sent as a bearer token. xAI connects to Phean on the bot's behalf, so the URL must be public. Issue the key from the Agents page (**Key for a bot**), one per bot, and keep it in the bot's secret store. The field names are in xAI's [remote MCP tools](https://docs.x.ai/developers/tools/remote-mcp) docs.

## Teach it Phean

Grok does not install Agent Skills. Put the [instructions to give any agent](/docs/agents#instructions-to-give-any-agent) into Grok's custom instructions, or a project's instructions, so every chat starts by syncing. For an API bot, put them, and the parts of `skills/phean-decisions/SKILL.md` it needs, in the system prompt.

## Sync up

Begin a chat with "Sync up with Phean". Grok calls `whoami`, reads the activity, and collects your answers.

## Hear back

- **In the chat.** Grok waits with `wait_for_answers` after asking, for up to 240 seconds.
- **On a schedule.** Where your Grok plan has scheduled tasks, schedule "Sync up with Phean and act on every answer" every hour or each morning. Answers wait in Phean until collected.
- **By webhook or WebSocket.** An API bot with its own server registers a webhook, or holds the WebSocket open, and calls Grok when an answer arrives. See [Your own bot](/docs/your-own-bot).
