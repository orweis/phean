# OAuth sign-in for MCP agents

Status: draft for approval. Calls that were not made by Or are marked **(my call)**.

## Why

Connecting an agent today means a person issues a `phn_` key on the Agents page and pastes it into a client. The key never expires by itself, sits in plain text in config files, and needs someone with `agent:manage`. Phean should work the way the MCP authorization spec expects: add the URL to a client, sign in, approve, and the agent is working, with no key to copy.

## Goals

- A standard MCP client can connect to `/mcp` with only the URL: it discovers Phean's authorization server, registers itself, sends the person through sign-in and approval, and gets tokens.
- One approval dialog sets the agent's name, its workspace, its access level, and how long access lasts.
- Each token reaches exactly one workspace. Another workspace means another connection and another approval.
- People can see and cut off every agent, and a cutoff takes effect on the agent's next request.
- Fixed `phn_` keys keep working as the secondary path, for unattended bots with no browser.

## Non-goals

- One token reaching several workspaces. The dialog is designed so this could come later.
- Fine-grained permissions beyond read, write and admin. Store the level so this can grow.
- Migrating the MCP transport to the 2026-07-28 changes (no `initialize`, no session id, new required headers). That is separate from authorization. The builder checks whether `mcp-handler` 2.3.0 keeps working with clients on that revision and reports back rather than expanding this work.
- Phean as a general OAuth provider for other apps, or as an OpenID identity provider.
- Removing or auto-expiring existing `phn_` keys.

## Anti-goals

This has failed, even if the flow works, if:

- A tool input, token claim from a client, or client-supplied value can choose the tenant. The tenant still comes only from a verified credential.
- An agent at any level can approve, achieve or abandon a goal. `goal:decide` stays human-only.
- A revoked, expired or orphaned agent keeps working until its access token runs out.
- A person can give an agent more than they hold themselves.
- A client's self-chosen name or logo can pass for a verified identity in the dialog.

## Decided by Or

- After a person signs in, a single dialog asks for the agent name and what it can access, with a list of workspaces and an access level on each (read, write, admin). This is option B in the mockup, [`2026-11-05-mcp-oauth-dialog.html`](2026-11-05-mcp-oauth-dialog.html).
- Only one workspace is selected per approval, and each workspace gets its own OAuth token.
- The same dialog asks how long the agent should have access, offering several options with a default.
- Fixed keys stay, secondary to OAuth.
- Finer-grained access comes later.

## How connecting works

1. The client calls `/mcp` without a token and gets a 401 whose `WWW-Authenticate` names the protected resource metadata.
2. The client reads that metadata, then the authorization server metadata.
3. The client identifies itself by a Client ID Metadata Document, or registers through DCR.
4. The browser opens. The person signs in with the existing sign-in page if needed, then sees the dialog.
5. On Allow, Phean creates the agent (or renews an existing one, see below) and the client receives tokens.
6. Every MCP request resolves to the agent row, and from there to the tenant, exactly as a `phn_` key does today.

## The dialog

- **Title:** "Connect {client name} to Phean", with the host of its redirect address beneath it, and text making clear the name is what the client calls itself.
- **Agent name:** required, limited by `LIMITS.name`, prefilled from the client name.
- **Workspace and access:** the person's workspaces as a single-select list with Read, Write and Admin on each. Write is the default level. Levels above the person's own limit are not offered.
- **Access lasts:** 1 day, 7 days, 30 days (default), 90 days, 1 year **(my call on the values)**. No "never" option, because fixed keys already cover that case **(my call)**.
- **Actions:** Allow (filled violet) and Cancel. Cancel returns `access_denied` to the client.
- A person with no workspaces is sent to create one and returned to the dialog **(my call)**.
- Follows DESIGN.md and goes into `PAGES` in `e2e/quality.spec.ts`.

## Access levels

The levels become rows in the matrix in `policy.ts`. The actor role `agent` is split into three **(my call on the shape)**. Levels map to `phean:read`, `phean:write` and `phean:admin` scopes, where each includes the ones below it.

| Level | Allows | Who can grant it |
| --- | --- | --- |
| Read | `workspace:read` only. Mutating tools are hidden from `tools/list` and refused if called. | Any workspace member |
| Write | Everything agents can do today, including their own webhook. Existing agents and all fixed keys stay at this level. | Any workspace member |
| Admin | Write, plus seeing agents and members and revoking other agents. | Workspace owners and admins |

Raising a level means approving again. There is no step-up prompt in this version **(my call)**.

Connecting an agent is a new `agent:connect` action held by members, owners and admins, because today only owners and admins can create agents. Members can also revoke agents they approved.

Or decided Admin agents manage agents only. This version adds three MCP tools for that level: `list_agents`, `revoke_agent` and `list_members`.

- An Admin agent can't issue fixed keys, because a key would outlive its expiry. It can't invite or remove people or change roles either, because an invitation would be a route around human-only `goal:decide`.
- Issuing fixed keys becomes its own `agent:issue_key` action, held by owners and admins. `agent:manage` now means revoking, and an Admin agent holds it.
- `member:manage` stays with people.
- `list_members` returns names and roles, not email addresses **(my call)**. An Admin agent can't revoke itself **(my call)**.

## Lifetime and cutoff

Better Auth has no per-grant lifetime, and a refreshed grant otherwise lasts indefinitely. JWT access tokens can't be revoked either. So the `agents` row is the source of truth, checked on every request **(my call)**:

- The token carries the agent id. After verifying signature, issuer, audience and expiry, the MCP handler loads the row, as `authenticateAgentToken` does now.
- The request is refused with a 401 when the agent is revoked, is past `accessExpiresAt`, or its approving user is gone or is no longer a member.
- The effective level is the lower of the granted level and what the approver can currently grant, so a demotion lowers the agent's access at once.
- Refresh also fails in those cases, and the refresh tokens are revoked when an agent is revoked.
- Access tokens last 1 hour and renew automatically within the chosen period **(my call)**.
- Refresh token reuse interval is 30 seconds. **Ruled after the spike:** at 0, one replayed refresh token ends the whole token family, and the family is client plus person, not agent, so one replay kills the refresh tokens of every agent that person approved on that client (normal under CIMD). Within the 30 seconds a replay gets the stored answer without the claims check, so the per-request row check at `/mcp` is what cuts off a revoked agent. See `REFRESH_REUSE_SECONDS` in `src/server/auth/auth.ts`.

When access ends, the client gets a 401 and sends the person back through the dialog.

**Renewing (my calls):**

- The match is the same person, workspace and agent name, not the client id, because a client id is shared across installs under CIMD and can change under DCR.
- A match on an agent that hasn't been revoked renews that row, keeping its history and watches, and replaces its old tokens: it deletes the refresh tokens, and `agents.tokens_not_before` refuses any access token issued in an earlier second. The dialog says so before Allow, for example "You already have an agent with this name. Allowing replaces its connection."
- Any other name creates a new agent, so two laptops stay two agents when given two names.
- Revoking is final. A revoked agent never comes back, and approving again under its name creates a new row, leaving the old history in place.

**Webhooks (my calls):** revoking disables them, as today. Expired and orphaned agents' webhooks pause through a check when deliveries are queued and dispatched, and resume on their own if the agent is renewed or its approver returns.

**Sub-agents (my calls, added when the branch moved to the current `main`):** agents can already issue `phn_` tokens for their sub-agents. A sub-agent only works while its parent works and can't exceed its parent's level, capped at Write. Without this rule, an expiring agent could mint itself a key that never expires.

## Spec checklist (MCP 2026-07-28)

- RFC 9728 protected resource metadata at `/.well-known/oauth-protected-resource/mcp`, plus `resource_metadata` in every 401.
- RFC 8414 authorization server metadata, with `issuer` exactly matching the URL it was derived from.
- OAuth 2.1 authorization code flow, PKCE S256 required.
- RFC 8707: tokens are bound to the `/mcp` resource, and the audience is checked on every request. No token passthrough.
- RFC 9207 `iss` on authorization responses, advertised in metadata.
- **CIMD and DCR both supported.** Or asked for DCR. The 2026-07-28 spec deprecates DCR in favour of CIMD while keeping it working, and clients in use today still rely on it, so Phean offers both, with `client_id_metadata_document_supported: true`.
- Public clients only through open DCR, with `native` for loopback redirects on any port.
- Invalid or expired tokens get 401. Tokens are only accepted in the `Authorization` header.
- Implementation reads the spec's security considerations page, which has MUST-level content not yet reviewed for this document.

## Building it

- **Library:** `@better-auth/mcp` and `@better-auth/cimd` with the `jwt` plugin, upgrading `better-auth` from 1.7.15 to 1.7.17 **(my call)**, because auth is already Better Auth, and it covers the spec items above.
- **Do a spike first.** Better Auth's consent call accepts only scopes, so our fields don't fit directly. The expected route: the dialog is the `postLogin` page, it stores the choices and creates the agent, `consentReferenceId` returns the agent id, and `customAccessTokenClaims` puts it in the token. The docs don't say whether claims re-run on refresh, or how `/.well-known` routes mount in Next.js. Also unverified: the docs say `resource` must be HTTPS, while local development, e2e tests and Vercel preview URLs all need to work. If the spike shows that the library can't do this cleanly, stop and report before choosing another route.
- **Data:** `agents` gains `authKind` (`key` or `oauth`), `accessLevel` (default `write`), `accessExpiresAt` and `oauthClientId`, and `tokenHash` and `tokenPrefix` become nullable. Better Auth's tables come through `pnpm db:generate`. Migrations stay compatible with the previous release.
- **Layering:** connecting and renewing are services in `domain/agents.ts`, with `assertCan` and `recordEvents` in a transaction. `Ctx` is still built only from a verified credential, and `actor` carries the level. `whoami` reports the level and expiry.
- **Client registration safety:** open registration is rate limited, and CIMD fetches are checked with the SSRF protections in `assertWebhookUrlSafe` **(my call)**.

## Agents page and docs

- "Connect an agent" leads with the URL and a no-key snippet per client, such as `claude mcp add --transport http phean-acme https://…/mcp`, and is shown to any member.
- Fixed keys move behind a quiet control labelled for unattended bots, with today's reveal flow unchanged.
- The agents table shows how each agent connects, its level, and when its access ends. Expired agents get their own status.
- Update `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `README.md`, the `AGENTS.md` rules on tokens, and `src/server/mcp/guidance.ts`.

## A second workspace on one client

Each connection is added under its own name, for example `phean-acme` and `phean-globex`, and approved separately. Some clients may store tokens per URL, in which case the second approval overwrites the first. The builder tests Claude Code, Cursor and VS Code. If any collide, add per-workspace URLs (`/mcp/w/{slug}`) with the slug preselecting the dialog, where the tenant still comes from the verified agent and a mismatch is refused **(my call)**.

## Testing

- Vitest through the real services and MCP handler: discovery documents, 401 challenge, DCR, PKCE failure, wrong audience, revoked, expired, orphaned and demoted agents, renewal keeping the same agent, each level against each tool, and `phn_` keys still working.
- `tests/isolation.test.ts`: a token from one workspace can't reach another. `tests/policy.test.ts`: the new roles and `agent:connect`.
- Playwright: the full flow using a scripted client with `@modelcontextprotocol/client`, the dialog in `PAGES`, a member not being offered Admin, and revoking from the Agents page.
- Manual check with at least Claude Code against a real deployment before calling it done.

## Left to the builder

File and component layout, the exact claim names, how the dialog keeps the pending request, cleanup of abandoned registrations, and copy, within DESIGN.md.
