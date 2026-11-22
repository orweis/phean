# Submit Phean to Anthropic's directory: the connector, then the plugin

You are helping me, on my machine, submit Phean (https://phean.ai, a hosted task and goal ledger for AI agents run by Permit Inc.) to Anthropic's directory. Read `docs/plugin/PLAN.md` in this checkout of `orweis/phean` first. Tasks 01 to 03 in this folder must be done: the public repository `orweis/phean-plugin` exists with the first release, and the OAuth sign-in works from the plugin in Claude Code and on claude.ai.

I do every step in the browser and click Submit myself; you prepare the answers, check them against the code and the live site, and keep a record. Never put a password, token or test account credential in a file, the portal's free-text fields, or this chat: the portal has its own place for reviewer credentials, or none, in which case we send them to Anthropic as its docs direct. Ask before anything that cannot be undone (the listing's URL slug is permanent once published).

## Before you start

1. I must be an **Owner** of a claude.ai organization on a paid plan (Pro, Max, Team or Enterprise). The portal is https://claude.ai/directory/manage. Limit: 10 submissions per organization per 24 hours, drafts included.
2. Re-read, and tell me anything that changed since this prompt was written: https://claude.com/docs/connectors/building/review-criteria, https://claude.com/docs/connectors/building/submission, https://claude.com/docs/plugins/submit and https://claude.com/docs/plugins/pre-submission-checklist, and the Software Directory Terms and Policy linked from them.
3. Check the live site has what reviewers open: https://phean.ai/privacy, https://phean.ai/terms, https://phean.ai/support, https://phean.ai/docs/claude-plugin, https://phean.ai/phean-icon.png. Each must load without signing in.
4. Owner decisions from `docs/plugin/PLAN.md` "Points the owner should look at": the terms' governing law and liability cap, the support page's answer time, and the GitHub link on the site. Also: the digest email is sent through Resend (`src/server/digest/email.ts`). If production sets `RESEND_API_KEY`, add Resend to the service providers in `content/legal/privacy.md` before submitting, since reviewers check third-party sharing.
5. Prepare a **reviewer account**: create a fresh Phean account for Anthropic's reviewers (an address you control, such as a `+anthropic-review` alias), with a workspace "Acme demo" holding sample goals, tasks, a pending decision and some memory (add them through the app or a connected Claude; do not point the repository's seed or demo scripts at production). Keep its password in my password manager only.

## Part 1: the MCP connector

In the portal: **Submit new**, **MCP connector**.

1. **Connection**: `https://phean.ai/mcp`. One URL for every user (the approval dialog picks the workspace), so do not choose multiple URLs.
2. **Tools**: they sync from the server. Every tool already has a title and read-only or destructive hints; report any the portal flags anyway.
3. **Listing**:
   - Name: `Phean`
   - One-liner (200 max): `The decision center for your AI agents: a shared task and goal ledger where agents do the work and you make the calls.`
   - Description (2,000 max), draft:
     > Phean is a shared task and goal ledger for teams of AI agents. Connect Claude and your other agents to one workspace, and they capture work from the sources they can reach, group it under goals, claim tasks so they never collide, and complete them with a note. When a task needs a person, Claude asks through Phean: the decision waits on your Decisions page with its context, options and a link back to the conversation, and Claude collects your answer when you give it. Agents hand work to each other or to a person without dropping it, attach drafts and notes as documents, and share long-term memory across the workspace. Phean has no connectors of its own and never reads your email, chat or files: it holds only what your agents and people put into it. Sign-in is OAuth; you choose each agent's workspace, access level (read, write or admin) and lifetime, and can revoke it at any time.
   - Categories: Productivity, Project management (pick the closest of what the portal offers).
   - Documentation URL: `https://phean.ai/docs/claude-apps`
   - Privacy policy URL: `https://phean.ai/privacy`
   - Support contact: `https://phean.ai/support` (or info@permit.io if it wants an email)
   - Icon: upload `public/phean-icon.png` (512 by 512).
   - URL slug: `phean`.
4. **Use cases** (at least three example prompts):
   - "Sync up with Phean: what changed since yesterday, and what should I pick up next?"
   - "Capture the action items from this thread as Phean tasks under the Q3 launch goal, due Friday."
   - "Ask me in Phean whether to ship the release tonight or after the freeze, with your recommendation, and wait for my answer."
   - "Hand the vendor review task to Dana in Phean with a note on where I left it."
   Prerequisites: a Phean account and workspace (sign up at phean.ai). Reads and writes: both.
5. **Company**: Permit Inc., https://phean.ai, primary contact me.
6. **Authentication**: OAuth 2.0, with dynamic client registration and client ID metadata documents, so Anthropic needs no client ID or secret from us.
7. **Data handling**: the API is our own, first party. No personal health data. No sponsored content.
8. **Test & launch**: confirm every tool was run (task 03 covers the main ones; run any untested read tool once from a custom connector).
9. **Compliance**: read each of the seven acknowledgements to me before I tick it.
10. Reviewer access: give the reviewer account per the portal's or the docs' instructions, never in a free-text field.

## Part 2: the plugin bundle

Once the connector is submitted: **Submit new**, **Plugin bundle**.

1. **Source**: repository `orweis/phean-plugin`, plugin path empty (the plugin is the repository's root), branch or tag empty (follows `main`) or the latest `phean--v*` tag.
2. **Validate**, fix any blocking finding in `plugin/` in `orweis/phean`, release again (see `docs/plugin/PLAN.md`, "Release routine"), and validate again.
3. **Listing details** come from `plugin.json` and the README; check they read well.
4. **Data handling**, draft answers (verify each against the code before I submit):
   - *Does the plugin read or store personal data?* Yes, through its connector. Phean stores account information (name, email; passwords only as salted hashes; GitHub or Google profile if used to sign in), the names and emails of workspace members and invitees, sign-in IP addresses and user agents, and the workspace content agents and people put in: tasks, goals, decisions and answers, memory, documents, links to agent sessions, and an activity log. The plugin itself stores nothing on the user's machine beyond the OAuth token Claude keeps.
   - *Does it send data to services other than its declared connectors?* No. Everything goes to `phean.ai`. Phean's own processors are Vercel (hosting and file storage) and Neon (database), plus Resend for digest emails if it is configured in production (check, see above). Webhooks go only to URLs a workspace registers.
   - *How long is data kept?* Stated from the code: account information while the account exists; workspace content (tasks, goals, activity log) until a permitted person or agent deletes it or the workspace is deleted. Memory is deleted when forgotten (`forget`); documents and their stored bytes when deleted (earlier versions' bytes are removed on each edit). Each task keeps at most 8 linked agent sessions and its 20 most recent closed questions. Webhook delivery logs are pruned after 7 days. Deleting an account or a workspace is on request to info@permit.io; there is no self-service deletion yet, so say so. Backups follow Neon's retention.
   - *Intended for people under 18?* No. Phean is a work tool; the terms require users to be 16 or older and it is not directed at children.
5. **Compliance**: contact email info@permit.io (or the address I choose); read the four acknowledgements to me before I tick them.
6. **Review and submit**: new versions reach the directory by the GitHub push webhook (default). Leave auto-publish off for now, so a reviewer publishes each version.

## Afterwards

- Record each submission's status and any reviewer feedback in `docs/plugin/PLAN.md`, in a short "Submissions" section, through a pull request.
- When the plugin's listing is live, update "The directory listing" in `content/docs/claude-plugin.md` with the exact install steps, and the plugin README's "Install" section; release a new version.
- Directory questions: the portal's "Get help", directory@anthropic.com (plugins), mcp-review@anthropic.com (connectors).

Report: what was submitted, each answer as given, the submission ids and statuses, and anything the portal asked that this prompt did not cover.
