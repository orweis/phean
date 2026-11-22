# Local tasks for the Claude plugin

Each file here is a self-contained prompt for a Claude Code session on the owner's own machine, for work the cloud session cannot do (creating repositories, tokens, signing in to claude.ai, the directory portal). Run them in order, from a checkout of `orweis/phean` on `main` once the plugin branch is merged (or on the plugin branch before that). Paste the whole file as the prompt.

1. [01-public-repository.md](01-public-repository.md): create `orweis/phean-plugin` and the sync token, and publish the first release.
2. [02-test-claude-code.md](02-test-claude-code.md): load the plugin in Claude Code and confirm the OAuth sign-in works. This is the key test.
3. [03-test-claude-ai.md](03-test-claude-ai.md): upload the plugin to claude.ai and connect it.
4. [04-submit-to-directory.md](04-submit-to-directory.md): submit the connector, then the plugin bundle, with draft answers.

No prompt asks for a secret in chat. Tokens go straight from the browser into GitHub's secret settings, or are typed by you into a CLI prompt.
