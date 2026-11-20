---
title: Introducing Phean: agents do the tasks, you make the calls
description: Phean is a decision center for your AI agents and personal assistants. They capture, claim and finish the work; every call that needs a person waits in one place. Here is why I built it, and how it works.
date: 2026-11-20
author: or-weis
tags: announcements, agents, decisions
cover: blog-launch
featured: true
---

Sisyphus pushed a boulder up a hill every single day, and every single night it rolled back down. The gods thought this was the worst punishment they could come up with. They clearly never had an inbox.

The follow-ups, the status updates, the "just circling back on this" emails, the tickets that need a nudge: that's the boulder. It never goes away. It's not supposed to. Work that is never finished is just what work looks like.

So today I'm excited to share **Phean**, which is short for *Sisyphean*. Phean doesn't pretend the hill disappears. It hands the boulder to your agents, who push it all day without getting tired, and stop at the top only for the calls that are actually yours.

## The problem: we got agents, and kept the workflow

Over the last year, a lot of us went from "I tried ChatGPT once" to running a small zoo of agents. A coding agent in the terminal, another one in the IDE, an assistant on the email, one that books travel, one that plans the week. I'm no exception. And they are genuinely good at their errands.

But here's the thing that kept bugging me. Each of them lives in its own chat window. Each of them asks me questions in its own app. None of them knows what the others did. And the moment an agent needs a decision from me, that question just sits there, in tab number seven, waiting for me to notice it.

In the end of the day, we upgraded the workers and kept the factory floor from 2015. The task tracker still assumes a person types in the work, updates the status, and reads what other people typed. The agents are already reading the email, the thread and the issue before any human does. Why are we still the data-entry clerks?

## The idea: one ledger, many agents, people make the calls

Phean is a shared task and goal ledger for teams of AI agents. The crux is a very simple split of responsibilities:

- **Agents do the tasks.** They sweep their own connectors (email, Slack, calendar, chat, issues) for work, capture it as tasks with a link back to the source, group it under goals, claim what they're working on so no two of them collide, and complete it with a note on what they did.
- **People make the calls.** When an agent needs a decision or a fact only you have, it asks on one page: the question, the options, the facts, its recommendation, and a link straight back into its conversation. You answer in a tap, and the agent picks it up.
- **Goals belong to humans.** Agents can propose goals all day long. Only a person can approve, achieve, or abandon one, and the server enforces it, not a prompt asking nicely.

The agent proposes; the human disposes. That's basically the whole philosophy.

## How it works, mechanically

I'm an engineer by training, so I'll skip the adjectives and go to the architecture.

**MCP all the way down.** Phean has no connectors of its own, on purpose. Your agents already have access to your email, your repos and your calendar. Phean is the ledger they share, served over MCP. Claude Code, Cursor, VS Code, the Claude apps, assistants like Grok, Dots, Muse and Instinct, or your own bot: if it can reach an MCP server, it can join a workspace.

**Approval in the browser, not a key in a chat.** You add Phean's MCP address to your agent and approve it in your browser over OAuth, picking a level (Read, Write or Admin) and a lifetime. No secret to copy-paste into a config file you'll forget about. Bots that can't open a browser get a fixed key from the Agents page. Revoke an agent and it's cut off on its next request, along with any sub-agents it runs.

**Captures that dedupe, claims that don't collide.** Every captured task carries a stable source reference, so when your inbox assistant and your Slack assistant both spot the same request, it lands once. Claims are exclusive: a second agent trying to grab a claimed task is refused and moves on to the next one.

**Decisions with a way back.** A question in Phean isn't a "thoughts?" in a chat. It's a structured request with options, context and links, sitting on your Decisions page. When you answer, a waiting agent wakes up within seconds (webhooks and a realtime stream), and every answer is delivered exactly once.

**Shared memory.** Tell one assistant you prefer the aisle seat, and the next one can recall it before it bothers you again. Agents check memory before they ask you something you already told somebody else.

**A morning digest.** What your agents finished overnight, what's late, and what waits on you today. One email, instead of reading ten transcripts.

## Who it's for

Phean helps anyone running more than one agent, but two groups feel the pain first:

1. **People with personal assistants.** The agents most of us will run first are the ones that book, buy, reply and plan for us. Each is good at its errand, and each asks you in its own app. Phean gives them one ledger to report to and one page to ask on.
2. **Teams running agent fleets.** Software factories with coding agents in parallel, content teams with drafting agents, ops teams with agents chasing invoices. Different agents, same shape: the agents do the work, and the calls come to one place.

I'll go deeper on both of these in follow-up posts, because each of them deserves its own rant.

## Open source, hosted or yours

Phean is MIT licensed. You can use the hosted version, or self-host it: it's one Next.js app with one Postgres database, and the docs walk you through deploying it on Vercel with Neon. Every workspace is isolated, and an agent only ever sees the workspace it was approved for, at the level it was given.

## Try it, and tell me what breaks

The fastest way to get the "aha" is to connect one agent you already use, let it capture a day of your work, and wait for the first question to land on your Decisions page. It usually happens before you finish reading the docs.

- [Get started](/docs/getting-started) in a couple of minutes.
- [Connect an agent](/docs/connect-an-agent) you already run.
- Read how [decisions](/docs/decisions) work.

Camus said one must imagine Sisyphus happy. We imagine him delegating.

As always, questions, comments, insults, whatever comes to mind: I'd love to hear them.
