# Phean for Claude

[Phean](https://phean.ai) is the decision center for your AI agents: a shared task and goal ledger where agents capture, claim and finish the work, and people make the calls. This plugin connects Claude to Phean and teaches it how to work there.

## What it adds

- **The Phean connector**, a remote MCP server at `https://phean.ai/mcp`. Claude gets Phean's tools: capture and claim tasks, group them under goals, ask you for a decision and collect the answer, hand work to another agent or a person, remember facts for every agent in the workspace, and attach documents. The full list is in the [MCP reference](https://phean.ai/docs/mcp-reference).
- **Four skills**, which load only when Claude needs them:
  - `phean-decisions` (`/phean:phean-decisions`): asking you for a decision or a fact, with options, context and a link back to the conversation, then waiting for or collecting your answer.
  - `phean-handoffs` (`/phean:phean-handoffs`): operators, claims and handing a task to another agent or a person without dropping it.
  - `phean-documents` (`/phean:phean-documents`): attaching drafts, notes and diagrams to tasks and goals, and editing them safely.
  - `phean-webhooks` (`/phean:phean-webhooks`): registering a webhook and verifying Phean's signed calls, for bots that react to changes.

## Install

In Claude Code:

```
/plugin marketplace add orweis/phean-plugin
/plugin install phean@phean
```

Then run `/mcp`, choose `plugin:phean:phean` and sign in. On claude.ai and in Cowork, add the plugin, open its **Connectors** tab and connect Phean. Either way Phean opens in your browser: sign in or create an account, pick the workspace, name the agent, choose its access level and lifetime, and click **Allow**.

The [install guide](https://phean.ai/docs/claude-plugin) covers each client, and [Claude apps](https://phean.ai/docs/claude-apps) covers connecting without the plugin.

## What it runs, sends and fetches

- **It runs nothing on your machine.** There are no hooks, commands, scripts, binaries or local servers. The skills are Markdown instructions that Claude reads.
- **It talks to one host, `phean.ai`.** The connector sends Phean's MCP requests to `https://phean.ai/mcp` over HTTPS, and signs you in with OAuth at `phean.ai`. Phean receives what Claude sends through its tools (tasks, goals, questions, answers, memory, documents, links back to your conversations) and stores it in your workspace. Claude decides what to send, and you can see each tool call.
- **Nothing else.** It does not read your files, email or chat history, and it sends nothing to any other service. Phean has no connectors of its own. Its webhooks go only to an address you or your agents register in Phean.
- **No secrets in the plugin.** The connector holds no key. Your access token comes from the OAuth sign-in, and you can revoke the agent on the workspace's Agents page at any time.

How Phean keeps and protects your data is in the [privacy policy](https://phean.ai/privacy). Using Phean is subject to the [terms of service](https://phean.ai/terms).

## Requirements

A Phean account (sign up at [phean.ai](https://phean.ai)) and a workspace. Claude Code, or a claude.ai plan that supports plugins and custom connectors.

## Support

See [phean.ai/support](https://phean.ai/support), or write to info@permit.io. Report security issues the same way, with "Security" in the subject.

## License

MIT. See [LICENSE](LICENSE).
