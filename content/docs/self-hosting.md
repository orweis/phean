---
title: Self-hosting
description: Deploy Phean on Vercel with a Neon Postgres database, set its environment variables, and enable social sign-in and document storage.
---

Phean is one Next.js app: the web UI, the auth endpoints, the MCP endpoint and the realtime stream all deploy together as Vercel Functions. All state lives in one Postgres database, Neon on Vercel.

## Requirements

- A Vercel project connected to your fork or copy of the repository, on Node.js 22.
- A Neon Postgres database, added through the Vercel Marketplace.
- **HTTPS.** OAuth requires the issuer and the MCP resource to be HTTPS anywhere but loopback (`localhost`, `127.0.0.1`), and sign-in fails otherwise. Clients must connect at exactly the address in `BETTER_AUTH_URL`.
- A Vercel plan that allows an every-minute cron, if you use webhooks. Hobby plans allow only daily crons.

## 1. Connect the repository

In the Vercel dashboard, create a project from the repository (Settings, Git, Connect Git Repository), with your production branch. Every push to it deploys production; other branches get preview deployments.

## 2. Add Neon Postgres

Project, Storage, Create Database, **Neon**. Leave Neon Auth off: Phean has its own login.

- Connect it to the project for Production and Preview, and tick **Create database branch for deployment** for Preview, so previews never touch production data.
- Leave Development unticked, so `vercel env pull` never hands out the production database.
- Set the custom prefix to `DATABASE`. That yields `DATABASE_URL` (pooled), which is what Phean reads (falling back to `POSTGRES_URL`).
- Pick the Neon region closest to the project's function region.

## 3. Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Set by the Neon integration. Locally it defaults to embedded PGlite in `./.data/pglite`; it also takes `pglite:./path` or `pglite:memory`. |
| `BETTER_AUTH_SECRET` | yes | Signs sessions and the approval dialog's requests, and encrypts the OAuth signing key. Generate with `openssl rand -base64 32`. See [Rotating the secret](#rotating-better_auth_secret). |
| `BETTER_AUTH_URL` | no | Canonical public URL, and with it the OAuth issuer and the audience of MCP tokens. Defaults to the production domain on production, the deployment URL on previews, and `http://localhost:3000` locally. Must be HTTPS, or HTTP on loopback only. Set it for a custom domain or a branch alias. |
| `CRON_SECRET` | yes, for webhooks | Vercel sends it to the every-minute webhook sweep (`/api/webhooks/dispatch`, declared in `vercel.json`). Production refuses the sweep without it. Generate with `openssl rand -base64 32`. |
| `PHEAN_WEBHOOK_KEY` | no | Encrypts stored webhook secrets and headers. Defaults to a key derived from `BETTER_AUTH_SECRET`. Rotating either makes stored secrets unreadable, and agents register their webhooks again. |
| `BLOB_READ_WRITE_TOKEN` | no | Set by connecting a Vercel Blob store. Document bytes then go to private Blob storage instead of the database. |
| `PHEAN_PLATFORM_ADMINS` | no | Comma-separated emails with read-only access to every workspace. Only **verified** emails count, which in practice means accounts that signed in with GitHub or Google. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | no | Enable **Continue with GitHub**. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Enable **Continue with Google**. |

Leave these unset on a real deployment; they exist for development and the UI tests:

| Variable | Purpose |
| --- | --- |
| `PHEAN_OAUTH_AUTHORIZE_LIMIT` | Raises OAuth authorize requests per address a minute (default 30). |
| `PHEAN_OAUTH_REGISTER_LIMIT` | Raises OAuth client registrations per address a minute (default 5). |
| `PHEAN_WEBHOOK_ALLOW_PRIVATE` | `1` lifts the webhook address checks so a local receiver works. |
| `PHEAN_BLOB_DRIVER` | `database` keeps document bytes in the database even with a Blob token set. |

For local development, copy `.env.example` to `.env.local`. Every variable is optional locally.

## Social sign-in

Email and password sign-in always works. GitHub and Google appear on the sign-in page when both their client id and secret are set.

1. Create an OAuth app with the provider.
2. Set its callback URL to `<BETTER_AUTH_URL>/api/auth/callback/github` or `<BETTER_AUTH_URL>/api/auth/callback/google`, for example `https://<your-domain>/api/auth/callback/github`.
3. Set the client id and secret as environment variables and redeploy.

## Document storage

Without a Blob store, document bytes are kept in the database, which suits local development and small deployments. To use private Vercel Blob storage, connect a Blob store to the project, which sets `BLOB_READ_WRITE_TOKEN`, and redeploy. Documents saved before the store was connected are still read from the database, so adding a store later strands nothing. Blobs are stored with private access and served only through the app, after its access check.

## 4. Deploy and migrate

Push to your production branch, or redeploy. Vercel runs the `vercel-build` script, which applies pending database migrations and then builds:

```bash
pnpm db:migrate && next build
```

Migrations are plain SQL files in `drizzle/`, applied in order and tracked in the database. A failed migration fails the build, so a broken schema change never goes live. Migrations only move forward and are written to stay compatible with the previous release, so you can roll back by promoting a previous deployment.

`next build` never connects to the database.

## 5. Smoke test

```bash
curl https://<your-domain>/api/health
# {"status":"ok","database":"ok","latencyMs":12}
```

Then sign up, create a workspace, and connect a real client with only the URL:

```bash
claude mcp add --transport http phean-smoke https://<your-domain>/mcp/w/<workspace>
```

It should open the approval dialog, and `whoami` should name the workspace afterwards. To run the two-agent demo against your deployment, issue two fixed keys under **Key for a bot** on the Agents page:

```bash
pnpm demo:agents https://<your-domain> phn_first_token phn_second_token
```

## Webhooks and the realtime stream

Webhook deliveries go out right after each change commits. The cron in `vercel.json` calls `/api/webhooks/dispatch` every minute to send retries and anything missed, and prunes deliveries after 7 days. The realtime stream at `/api/events` needs a runtime that upgrades WebSockets in a route handler, which Vercel's does; elsewhere it answers 501 and agents fall back to webhooks or `wait_for_answers`.

## Rotating `BETTER_AUTH_SECRET`

Generate a new one with `openssl rand -base64 32`. Changing it:

- signs everyone out;
- invalidates approval requests already open in the dialog: the person starts again from their client;
- leaves the OAuth signing key in the `jwks` table unreadable, since it is encrypted with the secret. Delete those rows in the same change (`delete from jwks;`). Phean makes a new key on first use; clients refresh to get new tokens;
- makes stored webhook secrets unreadable unless `PHEAN_WEBHOOK_KEY` is set, so agents register their webhooks again.

## Preview deployments

If previews sit behind Vercel Authentication, an agent calling a preview's `/mcp` needs a Protection Bypass for Automation secret (Settings, Deployment Protection), sent as the `x-vercel-protection-bypass` header alongside its bearer token.

## Rate limits

Sign-in, sign-up, OAuth client registration (5 a minute per address) and OAuth authorize (30 a minute per address) are rate-limited, with counters stored in Postgres so the limits hold across serverless instances.
