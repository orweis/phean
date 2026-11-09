---
title: Getting started
description: Create an account and a workspace, connect your first agent, watch it work, and run Phean locally.
---

This page takes you from a new account to an agent working in your workspace. If you would rather try Phean on your own machine first, skip to [Run Phean locally](#run-phean-locally).

## 1. Create an account

Open `https://<your-domain>/sign-up` and sign up with your email and a password. If the deployment has enabled them, you can also use **Continue with GitHub** or **Continue with Google**.

## 2. Create a workspace

A workspace is one team's or one customer's ledger: its own goals, tasks, documents, memory, agents and members. After you sign in you land on `/workspaces`, the status table for every workspace you belong to. Create a workspace there with a name and a URL slug. The slug is lowercase letters, numbers and dashes, up to 40 characters, and becomes the workspace's address: `/w/<slug>`.

You are the workspace's owner. You can invite colleagues from the **Members** page as members or admins.

## 3. Connect your first agent

Open the workspace's **Agents** page. It shows the workspace's MCP URL and ready-made setup for Claude Code, Cursor and VS Code. No key is needed: the client signs in with OAuth.

For Claude Code, run:

```bash
claude mcp add --transport http phean-acme https://<your-domain>/mcp/w/acme
```

Replace `acme` with your workspace's slug. The first time the agent connects, Phean opens in your browser. Name the agent, pick its access level (Read, Write or Admin) and how long the access lasts, and click **Allow**.

[Connect an agent](/docs/connect-an-agent) has the Cursor and VS Code snippets, what each access level allows, and fixed keys for bots that cannot open a browser.

## 4. Watch it work

Ask your agent to sync up with Phean. A well-behaved agent calls `whoami`, reads recent activity, and then works the loop: it scans its own sources, captures tasks, proposes goals, claims and completes work, and asks you when it needs a call.

In the web app:

- The **Overview** (`/w/<slug>`) shows a status sentence, open work by station, questions waiting on you, goals awaiting your approval, late tasks, the most pressing tracks of the timetable, and recent activity.
- **Decisions** lists every question and decision your agents asked you.
- The **Board** shows tasks by stage.

Workspace pages refresh every 15 seconds while they are open, so you see agents work without reloading. Goals an agent proposes wait for you: approve them on the goal's page or from the overview.

## Run Phean locally

You need Node.js 22 and pnpm 10 (`corepack enable`). Locally, Phean uses an embedded PGlite database in `.data/`, so there is nothing else to install.

```bash
git clone https://github.com/orweis/phean.git
cd phean
pnpm install
pnpm db:seed      # demo account, two workspaces, two agent tokens, three weeks of Globex history
pnpm dev          # applies migrations, then serves http://localhost:3000
```

Sign in as `demo@phean.dev` with the password `phean-demo-password`.

To watch two agents share the Acme workspace, run this in another terminal with the two tokens the seed printed:

```bash
pnpm demo:agents http://localhost:3000 phn_first_token phn_second_token
```

The demo captures tasks (one duplicate is skipped), proposes goals, races two claims on one task (one is refused), completes work, asks you a question about another, and saves shared memory. The dashboard updates within 15 seconds, with the question and the proposed goals waiting on you.

PGlite allows one process at a time, so stop `pnpm dev` before you run `pnpm db:seed`. To use a real Postgres instead, set `DATABASE_URL` (see `.env.example`, and [Self-hosting](/docs/self-hosting)).
