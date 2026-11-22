# Test the plugin in Claude Code, including the OAuth sign-in

You are working on my machine in a checkout of `orweis/phean` (Phean, https://phean.ai). Its Claude plugin is in `plugin/`: a `.mcp.json` that declares one remote MCP server, `{"mcpServers": {"phean": {"type": "http", "url": "https://phean.ai/mcp"}}}`, and four skills. Read `docs/plugin/PLAN.md` and `plugin/README.md` first.

The key question this test answers: **does Claude Code run the OAuth sign-in for an HTTP MCP server that a plugin bundles**, the same way it does for one added with `claude mcp add`? Anthropic's docs do not say. Phean's server answers an unauthenticated request with `401` and a `WWW-Authenticate` header pointing at `https://phean.ai/.well-known/oauth-protected-resource/mcp`, and supports dynamic client registration and client ID metadata documents.

Rules: I do the browser steps (signing in to Phean, clicking Allow). Never print an access token, a refresh token, or the contents of Claude Code's credential store. Do not change Claude Code's settings beyond what a step names.

Steps:

1. `claude --version`, and note it in the report.
2. `claude plugin validate plugin --strict --profile directory` must pass.
3. Start a fresh session with the plugin loaded from disk: `claude --plugin-dir ./plugin`. In it:
   - run `/plugin` (or `/plugins`) and confirm `phean` is listed as loaded from the directory;
   - run `/mcp` and confirm a server named `plugin:phean:phean` is listed, and note its state (it should say it needs authentication);
   - choose it and pick **Authenticate**. A browser should open on phean.ai. I will sign in, choose a workspace (use a test workspace), name the agent "Claude Code plugin test", choose Write and the shortest lifetime, and click Allow;
   - back in `/mcp`, confirm it now shows connected, and how many tools it lists.
4. Ask Claude in that session: "Call whoami on Phean and tell me the agent and workspace." Confirm it names the agent I approved.
5. Check the skills load: run `/phean:phean-decisions` and confirm the skill's text appears; ask "Which Phean skills do you have?".
6. Check the prompts: find the server's `sync_up` prompt among the slash commands (type `/` and look for a name containing `sync_up`), and note its exact name for `content/docs/claude-plugin.md`.
7. Restart the session (`claude --plugin-dir ./plugin` again) and confirm `/mcp` still shows connected, so the token was stored and is refreshed.
8. Clean up: on phean.ai, open the test workspace's Agents page and revoke "Claude Code plugin test". In `/mcp`, confirm the server now fails or asks to authenticate again.

If step 3's Authenticate does not appear, or the browser does not open, or the sign-in completes but `/mcp` still shows it failing: capture the exact messages (`claude --debug --plugin-dir ./plugin` writes more detail; redact any token values) and try the same URL as a plain server, `claude mcp add --transport http phean-test https://phean.ai/mcp`, then `/mcp`, Authenticate, to tell a plugin problem from a server problem. Remove `phean-test` afterwards with `claude mcp remove phean-test`.

Report, as a short table: each step, pass or fail, and what you saw. Then the exact names of the MCP server and the sync_up slash command. If OAuth failed only for the plugin-bundled server, say so first: that changes what we submit.
