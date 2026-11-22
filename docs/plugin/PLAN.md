# Phean as a Claude plugin

A short record of how Phean is packaged for Claude and Anthropic's directory: the decisions, where the checklist stands, and the release routine.

## Decisions

1. **Two listings at one URL.** Phean is submitted twice from https://claude.ai/directory/manage: the **MCP connector** `https://phean.ai/mcp` (a URL only; it lists as a Community connector), then the **plugin bundle** `phean`, whose `.mcp.json` points at the same URL and adds the four skills. The connector reaches people who browse connectors; the plugin brings the skills with it. Submit the connector first, so the plugin's server is an approved connector when it is reviewed.
2. **The plugin lives in `plugin/`** of this repository: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (a one-plugin marketplace with `source: "./"`), `.mcp.json`, `skills/`, `assets/icon.png`, `README.md` and `LICENSE`.
3. **`skills/` stays the source of truth.** The directory refuses symlinks and anything outside the plugin's folder, so `pnpm plugin` (`scripts/plugin.tsx`) copies `skills/` and `LICENSE` into `plugin/`, and renders the icon from the brand mark (`components/brand-tile.tsx`, which the Apple touch icon uses too) into `plugin/assets/icon.png` and `public/phean-icon.png`. `tests/plugin.test.ts` fails when a copy drifts.
4. **The connector URL is `/mcp`, not a workspace URL.** A plugin ships one fixed URL for everyone, and at `/mcp` the approval dialog picks the workspace. People who want several workspaces in one Claude Code add the workspace URLs by hand, as the docs say.
5. **A separate public repository, `orweis/phean-plugin`, holds only the plugin** (recommended over making this repository public). Reasons:
   - The directory needs a public github.com repository and scans what it submits. A repository with only Markdown, JSON and one PNG passes the scan and the size limits trivially, and its README is the plugin's.
   - Making this repository public is a separate, one-way decision: its full history, internal docs (`docs/PRD.md`, `docs/IDEAS.md`, `docs/MESSAGING.md`), seeds and infrastructure notes would all be published with it. The plugin should not wait on that decision, nor force it.
   - People install with `/plugin marketplace add orweis/phean-plugin`, which clones a few kilobytes rather than the whole app.
   - The directory's "one submission per repository and folder" rule and its GitHub push webhook then follow plugin releases only, not every app commit.
   - The cost is one sync job (`.github/workflows/plugin-release.yml`) and one fine-grained token. If the owner later makes this repository public, the plugin can be resubmitted from `plugin/` here; the listing's name stays `phean`.
6. **Validation.** CI's `check` job runs `claude plugin validate plugin --strict --profile directory` with a pinned Claude Code from npm, besides the unit tests in `tests/plugin.test.ts` (manifest, marketplace, `.mcp.json`, README, file rules, icon, and the directory's tool rules over `TOOLS`).
7. **New pages on phean.ai**: `/support` (contact, troubleshooting, security reports), `/terms` (a short terms of service), `/docs/claude-plugin` (install guide) and `/phean-icon.png` (512px icon). They are linked from the footer, the sitemap and the Agents menu, and scanned by `e2e/quality.spec.ts`.

## Checklist

Plugin bundle (pre-submission checklist):

| Item | Status |
| --- | --- |
| `plugin.json` in `.claude-plugin/`; name `phean` (lowercase, no reserved words) | Done |
| `description`, `author`, `version` set | Done |
| `displayName`, `homepage`, `repository`, `license`, `keywords`, `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `termsOfServiceUrl` | Done. `repository` names `orweis/phean-plugin`, which does not exist yet (owner) |
| README of 40+ words outside code, describing everything it runs, sends and fetches | Done |
| `LICENSE` (MIT) and `license` field | Done |
| Remote MCP entry: `type: "http"`, absolute https `url` | Done |
| Regular files only, text under 256 KiB, no secrets | Done (tested) |
| `claude plugin validate --strict --profile directory` | Passes locally and in CI |
| Public github.com repository | Owner: [01-public-repository.md](local-tasks/01-public-repository.md) |
| OAuth sign-in works from a plugin-bundled server in Claude Code | Owner: [02-test-claude-code.md](local-tasks/02-test-claude-code.md). Not documented by Anthropic; this is the key test |
| Works when uploaded on claude.ai and in Cowork | Owner: [03-test-claude-ai.md](local-tasks/03-test-claude-ai.md) |
| Submitted by an Owner on a paid plan; data-handling answers | Owner: [04-submit-to-directory.md](local-tasks/04-submit-to-directory.md) |

Connector (review criteria):

| Item | Status |
| --- | --- |
| Every tool has a `title`, `readOnlyHint` and `destructiveHint`; names of 64 characters or fewer | Done (tested in `tests/plugin.test.ts` and `tests/mcp.test.ts`) |
| Read and write are separate tools; no catch-all tool | Done |
| OAuth 2.0 over Streamable HTTP, CA-issued certificate | Done |
| Actionable errors (`DomainError` messages, not bare 500s) | Done |
| Privacy policy covering collection, use, retention, sharing, contact | Done (`/privacy`) |
| Support contact and security reports | Done (`/support`) |
| Public documentation of purpose, setup and troubleshooting | Done (`/docs`, `/docs/claude-plugin`) |
| A test account with sample data for reviewers | Owner (in 04) |
| Three example prompts | Drafted in 04 |
| Domain ownership of phean.ai | Owner, in the portal (in 04) |

Points the owner should look at:

- `/terms` and the support page's two-business-day answer time are drafts written for this release. Have them read before submitting, particularly the Delaware governing law clause and the liability cap.
- The site links `https://github.com/orweis/phean` as "open source". While that repository is private, the link is a 404 for visitors and reviewers. Either make it public or point `GITHUB_URL` (`components/site/site-links.ts`) at the plugin repository.
- The digest email goes through Resend (`src/server/digest/email.ts`), which `/privacy` does not list among its service providers. If production sets `RESEND_API_KEY`, add it there before submitting: reviewers check third-party sharing.
- `LICENSE` names Or Weis as the copyright holder, while the manifest's author is Permit Inc., which runs the service. Both are true; change one if they should agree.

## Release routine

1. Change the plugin (or a skill, then `pnpm plugin`). `pnpm check` must pass.
2. Bump `version` in `plugin/.claude-plugin/plugin.json` **and** the entry in `plugin/.claude-plugin/marketplace.json` (the test checks they agree). Every release gets a new version, or Claude Code will not update installed copies.
3. Merge to `main`, then from an up-to-date `main`: `claude plugin tag plugin --push`. It creates and pushes `phean--v<version>`.
4. The tag runs `Release the Claude plugin`, which validates, checks the tag matches the version and the copies match, and pushes `plugin/` with the same tag to `orweis/phean-plugin`.
5. The directory hears the push (GitHub push webhook, the default) and scans the new version; an Anthropic reviewer publishes it unless auto-publish is on.
6. Never rename `name` (`phean`) once published; the listing and every installed copy key on it.
