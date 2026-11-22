# Create the public plugin repository and its sync token

You are working on my machine in a checkout of the private repository `orweis/phean` (Phean, a Next.js app at https://phean.ai). Its Claude plugin lives in `plugin/` (read `docs/plugin/PLAN.md` first). A GitHub Actions workflow, `.github/workflows/plugin-release.yml`, copies `plugin/` into a separate public repository whenever a tag `phean--v<version>` is pushed. Your job is to create that public repository, give the workflow a token for it, and publish the first release.

Rules: never print, paste or echo a token or secret, in chat, in a file, or in a command's arguments. When a secret is needed, open the right GitHub page for me and let me paste it there myself, or have `gh secret set` read it from a prompt I type into. Ask me before any step that is hard to undo (creating the repository, pushing a tag).

Steps:

1. Check `gh auth status` shows I am signed in to github.com with rights on the `orweis` account. If not, ask me to run `gh auth login` myself.
2. Create the public repository, empty, with no README (the plugin brings its own):
   `gh repo create orweis/phean-plugin --public --description "Phean for Claude: the Phean connector and its skills, as a Claude plugin" --homepage https://phean.ai`
   Then push an initial commit so the repository has a default branch `main`: clone it to a temporary folder, copy in the contents of `plugin/` (including `.claude-plugin/` and `.mcp.json`), commit "Phean plugin" and push. Run `claude plugin validate . --strict --profile directory` in that clone first; it must pass.
3. Create the sync token. Open https://github.com/settings/personal-access-tokens/new for me and tell me to create a **fine-grained** token:
   - name `phean-plugin-sync`, expiry one year (put a reminder in my calendar to renew it);
   - resource owner `orweis`, repository access **Only select repositories**: `orweis/phean-plugin` only;
   - repository permissions: **Contents: Read and write** (Metadata read-only comes with it). Nothing else.
   I copy it myself. Then run `gh secret set PLUGIN_REPO_TOKEN --repo orweis/phean` and let me paste it at its prompt. Confirm with `gh secret list --repo orweis/phean` that the name exists (it never shows the value).
4. If the plugin repository is not `orweis/phean-plugin`, set `gh variable set PLUGIN_REPO --repo orweis/phean --body <owner>/<name>` and update `repository` in `plugin/.claude-plugin/plugin.json`, the commands in `plugin/README.md` and `content/docs/claude-plugin.md`, then `pnpm check`.
5. Protect the public repository: in its settings, turn on "Require a pull request before merging" with bypass for the token's owner only if branch protection would block the workflow's push; otherwise leave `main` open to the token alone. Turn on private vulnerability reporting (Settings, Security) so reports reach us.
6. Publish the first release from an up-to-date `main` of `orweis/phean` (after the plugin PR is merged): `claude plugin tag plugin --push`. Watch the "Release the Claude plugin" run with `gh run watch --repo orweis/phean`. When it succeeds, `orweis/phean-plugin` has the plugin at its root and the tag `phean--v0.1.0`.
7. Check an install from GitHub works in a scratch folder: `claude plugin marketplace add orweis/phean-plugin`, then `claude plugin install phean@phean`, then `claude plugin list`. Remove them again afterwards if I do not want them installed.

Report: the repository URL, the workflow run URL, the tag, and the output of the install check. Say plainly if any step failed.
