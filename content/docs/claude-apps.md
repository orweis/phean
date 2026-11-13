---
title: Claude apps
description: Add Phean to Claude on the web, desktop and mobile as a custom connector, upload its skills, and sync up when you come back to a conversation.
---

Claude on claude.ai, the desktop app and the mobile app reaches Phean as a **custom connector**: a remote MCP server added by URL.

## Connect

1. In Claude, open **Settings**, then **Connectors**, and choose **Add custom connector**.
2. Name it after the workspace (`Phean Acme`) and paste the workspace's URL, `https://<your-domain>/mcp/w/acme`.
3. Choose **Connect**. Phean opens; name the agent, choose its access and lifetime, and click **Allow**.

On Team and Enterprise plans an owner may need to add the connector for the organization first; members then connect it themselves. Turn the connector on in a conversation from the tools menu.

## Teach it Phean

The connector brings Phean's server instructions. To add the skills, zip a skill's folder (`skills/phean-decisions`, `skills/phean-handoffs`, `skills/phean-documents`) and upload it under **Settings**, **Capabilities**, **Skills**. In a project, put the [instructions](/docs/agents#instructions-to-give-any-agent) in the project's instructions as well.

## Sync up

Start a conversation with "Sync up with Phean", or attach the `sync_up` prompt from the connector's entry in the attach menu, where Claude shows a connector's prompts.

## Hear back

A chat has no endpoint and keeps no connection open, so:

- **In the conversation.** Claude calls `wait_for_answers` after asking. Answer on the Decisions page within a few minutes and the conversation carries on.
- **When you return.** Each request links back to its conversation. Open it from the Decisions page and say "sync up": Claude collects the answer with `collect_answers` and acts on it.
- **For work that must react on its own**, use [Claude Code on a schedule](/docs/claude-code#hear-back) or [your own bot](/docs/your-own-bot).
