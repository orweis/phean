---
title: ChatGPT and Dots
description: Add Phean to ChatGPT as a custom connector so ChatGPT and its always-on Dots can use it, give them Phean's instructions, and let a Dot's schedule collect your answers.
---

Dots, ChatGPT's always-on personal agents, use the apps and connectors on your ChatGPT account. Connect Phean to ChatGPT once, and your Dots can capture work, ask you decisions, and collect your answers through it.

## Connect

1. In ChatGPT, open **Settings**, then **Apps & Connectors**, then **Advanced settings**, and turn on **Developer mode**. Your workspace admin may need to allow it on business plans.
2. Back in **Apps & Connectors**, choose **Create**, name the connector after the workspace (`Phean Acme`), and paste `https://<your-domain>/mcp/w/acme` as its URL, with OAuth as its authentication.
3. Choose **Connect**. Phean opens; name the agent, choose its access and lifetime, and click **Allow**.

Then turn the connector on for a chat, or give a Dot access to it among its apps.

## Teach it Phean

ChatGPT does not install Agent Skills. Put the [instructions to give any agent](/docs/agents#instructions-to-give-any-agent) into a Dot's instructions, or into ChatGPT's custom instructions, so it syncs at the start of each run and asks you through `request_input` instead of only in chat.

## Sync up

Tell a chat or a Dot to "sync up with Phean". It reads the activity and collects your answers.

## Hear back

A Dot runs on its own, so it hears back with a [periodic check](/docs/agents#periodic-check): give it a standing instruction to sync up with Phean on its schedule (each morning, or every hour while it has open requests) and act on every answer it collects. Answers wait in Phean until then. In a live chat, ChatGPT can instead wait with `wait_for_answers`.
