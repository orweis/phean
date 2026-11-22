# Test the plugin on claude.ai and in Cowork

You are working on my machine in a checkout of `orweis/phean` (Phean, https://phean.ai). Its Claude plugin is in `plugin/`: one remote MCP server, `https://phean.ai/mcp` (OAuth), and four skills. Read `docs/plugin/PLAN.md` and `plugin/README.md` first. Anthropic's docs say remote MCP servers with a fixed https URL and skills both load in chat and in Cowork, where the server appears on the plugin's **Connectors** tab, and that a plugin may be uploaded (up to 5,000 files and 200 MB).

I do every browser step myself. You prepare the upload, tell me exactly what to click, and record what happens. Never ask me to paste tokens or cookies.

Steps:

1. Build the upload: `claude plugin validate plugin --strict --profile directory` must pass. Then zip the plugin folder's contents (so `.claude-plugin/plugin.json` sits at the zip's root, hidden files included) into `~/Desktop/phean-plugin.zip`: `cd plugin && zip -r -X ~/Desktop/phean-plugin.zip . -x '*.DS_Store' && cd ..`. List the zip with `unzip -l` and confirm `.claude-plugin/plugin.json`, `.mcp.json`, `skills/*/SKILL.md`, `assets/icon.png`, `README.md` and `LICENSE` are in it.
2. Look up the current place in claude.ai to add your own plugin (search Anthropic's help center, for example https://support.claude.com, for "upload plugin"), and tell me the clicks. My plan and role decide whether I can; if the option is missing, say what the help center says is needed.
3. After I upload it: ask me to open the plugin and confirm its name ("Phean"), icon and description show, and its **Connectors** tab lists Phean.
4. I choose **Connect**. Phean's approval page should open: I sign in, choose a test workspace, name the agent "claude.ai plugin test", choose Write and the shortest lifetime, and Allow. Ask me to confirm the connector then shows connected.
5. In a new chat, with the connector on from the tools menu, I ask: "Sync up with Phean." Ask me whether Claude called Phean's tools (`whoami`, `get_activity`, `list_tasks`) and what it said.
6. Skills: I ask "Ask me, through Phean, whether to ship the release tonight or tomorrow." Claude should use the phean-decisions skill and `request_input`; the decision should appear on the workspace's Decisions page with a link back to the chat. Ask me to answer it there, then say "collect my answer" in the chat.
7. Repeat steps 5 and 6 in Cowork, if I have it.
8. Clean up: revoke "claude.ai plugin test" on the workspace's Agents page; drop the test task; remove the uploaded plugin if I do not want to keep it.

Report a table of each step (pass or fail, and what I saw), plus anything that differed from `content/docs/claude-plugin.md`'s "claude.ai and Cowork" section, with the exact wording of menus, so the docs can be corrected.
