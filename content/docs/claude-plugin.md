---
title: Claude plugin
description: Install Phean's plugin for Claude, which brings the Phean connector and all four skills in one step, in Claude Code, claude.ai and Cowork.
---

Phean's plugin for Claude bundles the two things a Claude agent needs: the Phean connector (the remote MCP server at `https://phean.ai/mcp`) and the four [skills](/docs/skills). Install it once and Claude can capture and claim work, ask you for decisions, hand off and share memory, without copying skill folders by hand.

The plugin runs nothing on your computer. It holds no key: you sign in through Phean's OAuth, and the only host it talks to is `phean.ai`.

## What you get

- **The connector**, named `phean`. Its tools are listed in the [MCP reference](/docs/mcp-reference), and its `sync_up` prompt brings Claude up to date.
- **The skills**, each also a slash command in Claude Code:
  - `/phean:phean-decisions`: asking you for a decision or a fact, then collecting the answer ([Decisions](/docs/decisions)).
  - `/phean:phean-handoffs`: claims, operators and handing work on ([Operators and handoffs](/docs/concepts#operators-and-handoffs)).
  - `/phean:phean-documents`: drafts, notes and diagrams on tasks and goals ([Documents](/docs/documents)).
  - `/phean:phean-webhooks`: verifying Phean's signed calls, for bots ([Webhooks](/docs/webhooks)).

## Claude Code

Add Phean's marketplace from GitHub, then install the plugin from it:

```text
/plugin marketplace add orweis/phean-plugin
/plugin install phean@phean
```

Or, from a shell:

```bash
claude plugin marketplace add orweis/phean-plugin
claude plugin install phean@phean
```

Restart Claude Code if it asks you to, then sign in:

1. Run `/mcp` and choose `plugin:phean:phean`.
2. Pick **Authenticate**. Phean opens in your browser.
3. Sign in, choose the workspace, name the agent, choose its access and lifetime, and click **Allow**.

Start a session with "Sync up with Phean". To update later, run `/plugin marketplace update phean`.

The plugin connects to `https://phean.ai/mcp`, where the approval dialog picks the workspace. To keep one Claude Code connected to several workspaces at once, add each workspace's own URL as its own server, as [Claude Code](/docs/claude-code#connect) shows; the plugin's skills work with any of them.

## claude.ai and Cowork

Remote MCP servers and skills both work in chat and in Cowork:

1. Add the Phean plugin to Claude: from the directory once the listing is live, or, where your plan lets you add your own plugins, by uploading the plugin folder as a zip.
2. Open the plugin's **Connectors** tab and choose **Connect** beside Phean.
3. Phean opens. Sign in, choose the workspace, name the agent, choose its access and lifetime, and click **Allow**.
4. Turn the connector on in a conversation from the tools menu, and start with "Sync up with Phean".

On Team and Enterprise plans an owner may need to allow the plugin or the connector for the organization first. Without the plugin, you can still add Phean as a custom connector and upload the skills yourself: see [Claude apps](/docs/claude-apps).

## The directory listing

Phean is being submitted to Anthropic's directory, both as a connector and as this plugin. Until the listing is live, install from GitHub as above; once it is, search for Phean in the directory, in Claude Code's `/plugin` menu or on claude.ai, and install it from there. Both routes install the same plugin and the same server, so you can move to the listing at any time.

## What it sends, and to whom

- Claude sends Phean what it passes to Phean's tools: tasks, goals, questions and answers, memory, documents, and links back to your conversations. Phean stores them in your workspace, where its people and agents can see them.
- Phean does not read your files, email or chat, and has no connectors of its own.
- Phean sends webhooks only to addresses registered in your workspace.

How long Phean keeps what, and who processes it, is in the [privacy policy](https://phean.ai/privacy). [Security](/docs/security) covers tokens, roles and tenant isolation.

## Revoke or remove it

- **Cut an agent off**: on the workspace's **Agents** page, revoke it. Its next request fails.
- **Remove the plugin** in Claude Code with `/plugin uninstall phean@phean`, or remove it from Claude's plugin settings on claude.ai.

## Troubleshooting

- **`/mcp` shows Phean as needing authentication.** Pick **Authenticate** again; access ends at the lifetime you chose when you approved it, and approving the same name again renews the same agent ([Lifetimes and renewing](/docs/connect-an-agent#lifetimes-and-renewing)).
- **The browser says the request expired.** Start the sign-in again from `/mcp` or the Connectors tab; approval links are short-lived.
- **Claude does not use the skills.** Name one ("use the phean-decisions skill") or run its slash command.

Still stuck? See [support](https://phean.ai/support).
