---
title: Security
description: How Phean isolates workspaces, how people sign in and use two-factor, who may do what, how agent credentials are checked on every request, and how webhooks stay safe.
---

## Tenant isolation

Every workspace is a separate tenant, and an agent only ever sees its own workspace.

- **The credential decides the workspace.** A fixed key or an OAuth access token resolves to one agent record, and that record alone says which workspace the agent works in, which agent it is, and its level. No tool takes a workspace argument, and Phean never accepts a workspace id or slug from tool input, or from an OAuth token's claims: the token names only the agent.
- **The slug never chooses the tenant.** At a workspace's own MCP URL, `/mcp/w/<slug>`, a credential whose agent works in any other workspace is refused. The URL must agree with the agent's record; it never picks it. An OAuth token for a workspace's URL carries that URL as its audience, and Phean refuses to issue one to an agent of another workspace.
- **Every query is scoped.** Each domain table carries the tenant, and services filter every read and write by it. Composite foreign keys mean a task cannot point at another workspace's goal even if a service had a bug.
- **People see only their workspaces.** In the web app, a workspace you are not a member of returns the same 404 as one that does not exist.
- **Document bytes** are reached only through services after a tenant-scoped lookup, and served only from `/w/<slug>/documents/<id>/file` after a session check.

## Signing in

People sign in with a password, GitHub, or Google. Agents never use these: they connect with their own OAuth tokens or keys (see [Agent credentials and liveness](#agent-credentials-and-liveness)).

- **Connect more than one way in.** On **Account and security** (the account menu, top right), connect GitHub or Google while signed in, or add a password if you started with a provider. Any connected method signs you in to the same account. The provider must have verified its email address, which may differ from your Phean one. The last method can't be removed, so you can't lock yourself out.
- **Two-factor authentication.** Turn it on from the same page with an authenticator app (1Password, Google Authenticator, Authy, and the like). Phean shows a QR code and a setup key, checks one code before turning it on, and gives you ten backup codes, each good for one sign-in. From then on every sign-in asks for a code: after a password, and after GitHub or Google too. **Trust this browser** skips the code on that browser for 30 days.
- **Changing it takes your password.** Turning two-factor on or off, and new backup codes, ask for your password when you have one. Changing your password can sign you out everywhere else. Removing a sign-in method needs a session from the last day.
- **Codes are rate limited.** Five wrong codes end that sign-in attempt, and ten in a row lock the second step for 15 minutes.
- **Invitations are links.** Phean does not send email to confirm an address, so whoever holds an invitation link can accept it within its seven days, with the role it names. Share it privately, invite as a member unless the person needs admin, and cancel an invitation you no longer need from the **Members** page.

## Browser protections

Every page refuses to be framed by another site (`frame-ancestors 'none'` and `X-Frame-Options: DENY`), so one-click actions such as Revoke cannot be clickjacked; only a document's own file may be embedded, and only by Phean's document page. Responses also send `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and, on production builds, `Strict-Transport-Security`. After signing in, Phean returns only to paths on its own origin. The scheduled routes (`/api/webhooks/dispatch`, `/api/digest`) require `CRON_SECRET` on every production build.

## The role matrix

People are owners, admins or members of a workspace. Platform admins (emails in `PHEAN_PLATFORM_ADMINS`, verified only) read every workspace. An agent's role is its effective access level.

| Action | Owner | Admin | Member | Admin agent | Write agent | Read agent | Platform admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `workspace:read` | yes | yes | yes | yes | yes | yes | yes |
| `goal:write` | yes | yes | yes | yes | yes | no | no |
| `goal:decide` | yes | yes | yes | no | no | no | no |
| `task:write` | yes | yes | yes | yes | yes | no | no |
| `memory:write` | yes | yes | yes | yes | yes | no | no |
| `document:write` | yes | yes | yes | yes | yes | no | no |
| `agent:connect` | yes | yes | yes | no | no | no | no |
| `agent:delegate` | yes | yes | no | yes | yes | no | no |
| `webhook:manage` | yes | yes | no | yes | yes | no | no |
| `agent:manage` | yes | yes | no | yes | no | no | no |
| `agent:issue_key` | yes | yes | no | no | no | no | no |
| `member:manage` | yes | yes | no | no | no | no | no |
| `workflow:manage` | yes | yes | no | no | no | no | no |

What the actions mean:

- `goal:decide`: approve, achieve, abandon or reactivate a goal.
- `agent:connect`: approve an agent in the OAuth dialog. Members grant up to Write; Admin needs `agent:manage`.
- `agent:delegate`: run sub-agents. `webhook:manage`: an agent's own webhook; owners and admins can remove any agent's.
- `agent:manage`: revoke other agents. A member may still revoke the agents they approved, and their sub-agents.
- `agent:issue_key`: issue fixed `phn_` keys. `member:manage`: invite and remove members. `workflow:manage`: edit the board's stages.

## Human-only actions

"The agent proposes, the human disposes" is enforced on the server, not only in the prompts:

- `goal:decide` belongs to people only. Agent-created goals always start as proposed, and no agent level can approve, achieve or abandon a goal.
- Issuing fixed keys and managing members stay with people. An Admin agent cannot issue keys, because a key would outlive its expiry, and cannot manage members, because an invitation would be a way around `goal:decide`.
- Only a person can answer an agent's request, and only the person who answered can take the answer back.

## Agent credentials and liveness

An agent's bearer is one of two kinds:

| Kind | How it is checked | Level | Lifetime |
| --- | --- | --- | --- |
| OAuth access token | A signed JWT, verified locally for signature, issuer, audience (the endpoint it was sent to), type and expiry. Phean reads only its `agent_id` claim. | Chosen in the approval dialog | Tokens last an hour and refresh until the lifetime chosen: 1, 7, 30, 90 or 365 days |
| Fixed `phn_` key | 256 bits of randomness, shown once, stored only as a hash. | Write | Never expires; revoke it |

Either way, every request reads the agent's record and checks that it is live:

- not revoked;
- not past the end of its access;
- for an OAuth agent, its approver is still a member of the workspace;
- for a sub-agent, its parent is all of these too.

So revoking an agent, its access ending, or its approver leaving cuts it off on its next request. Refreshing a token re-checks the agent the same way. The realtime stream re-checks every 30 seconds and closes with 4401.

An agent's effective level is the lowest of its own level, what its approver can grant now, and (for a sub-agent) its parent's level. Each level has its own MCP tool list, and each call is checked again when it runs.

Renewing an agent (approving the same name again) cuts off the old connection's refresh tokens and refuses access tokens issued before the renewal.

## Webhook URL safety

Phean's servers call URLs that agents choose, so every webhook URL is checked before Phean will call it:

- It must use `https://`, carry no credentials, and not name `localhost` or a `.localhost`, `.internal` or `.local` host.
- Every address the host resolves to must be public. Refused: loopback, RFC 1918 private ranges, link-local (including `169.254.169.254`, the cloud metadata endpoint), carrier-grade NAT, unique-local, multicast and reserved ranges, NAT64, 6to4, Teredo, and IPv4-mapped and IPv4-compatible forms of all of these.
- The check runs at registration and again before every send, because DNS changes.
- Each send connects to the address that was checked, keeping the hostname for TLS and the `Host` header, so a name cannot resolve to a public address for the check and a private one for the connection (DNS rebinding).
- Redirects are never followed.

## What payloads contain

Webhook payloads and realtime events carry the event, not the object: the action, a summary, the actor, the event's data (ids such as `taskId` and `goalId`), the reasons it was sent, and a link into Phean. They never carry secrets. A bot reads current state with `get_task`, `get_goal` or `collect_answers`, which go through the same access checks as every other call.

Each webhook request is signed with HMAC-SHA256 under the webhook's secret, with a timestamp receivers check to reject replays. Webhook secrets and an endpoint's own headers are stored encrypted with AES-256-GCM and never shown again. See [Webhooks](/docs/webhooks).

## Links from agents

Links agents leave on tasks, questions and sessions are agent input rendered for people to click. They must use `https`, `http`, or a known app scheme (`cursor`, `vscode`, `vscode-insiders`, `windsurf`, `zed`, `claude`, `slack`, `msteams`); `javascript:`, `data:` and `file:` are refused. Web links open in a new tab with `noopener noreferrer`. Agent Markdown renders without raw HTML, images from other hosts show as links rather than loading (so a planted image cannot tell its host who read the document), and HTML documents are shown only as source.

## What agents should never do

- Put secrets, tokens or passwords in tasks, memories or documents: everyone in the workspace can read them.
- Paste a sub-agent's token into chat. Hand it to the sub-agent's MCP connection only.
- Put a token in the realtime stream's URL, or an endpoint's credentials in a webhook URL.
