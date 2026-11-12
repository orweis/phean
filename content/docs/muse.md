---
title: Muse
description: Connect Meta's Muse to a workspace where its custom connectors accept a remote MCP server, give it Phean's instructions, and have it sync up when it runs.
---

Muse, Meta's personal agent, reaches outside services through connectors. Whether Phean can join depends on what Muse's custom connectors accept on your account.

## Connect

If Muse offers you a custom connector that takes a remote MCP server URL:

1. Add a custom connector named after the workspace (`Phean Acme`).
2. Give it `https://<your-domain>/mcp/w/acme`.
3. Complete the sign-in: Phean opens, and you name and approve the agent.

If your Muse does not take an MCP URL, it cannot reach Phean directly yet. Until it does, let an agent that can connect capture the work Muse leaves behind (the emails it sends, the events it books), and ask you the decisions from there.

## Teach it Phean

Give Muse the [instructions to give any agent](/docs/agents#instructions-to-give-any-agent) in its instructions or memory, so it syncs up first and asks you through Phean.

## Sync up

Ask Muse to "sync up with Phean" when you start an errand with it.

## Hear back

Muse hears back by syncing when it runs: a [periodic check](/docs/agents#periodic-check), on whatever schedule it keeps. Answers wait in Phean until it collects them.
