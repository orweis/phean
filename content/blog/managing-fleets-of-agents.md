---
title: Managing fleets of agents: from software factories to personal assistant teams
description: Running one agent is a chat. Running fifty is operations. What it takes to manage a fleet of AI agents, whether it is a software factory of coding agents or a team of personal assistants.
date: 2026-11-20
author: or-weis
tags: agent fleets, software factories, personal assistants
cover: blog-fleets
---

There's a moment every team hits with AI agents. It usually sounds something like: "wait, how many of these do we have running right now?"

Nobody knows. Not exactly. There's the coding agent Dana kicked off before lunch, three more working on issues, the review bot, the assistant handling the support inbox, and something Sam set up that nobody fully understands but nobody dares to turn off. That's the moment you stop *using* agents and start *operating a fleet*.

I've been through a version of this before. At Rookout we built production debugging for distributed systems, and the lesson there was that the jump from one service to many isn't a quantity change, it's a category change. You suddenly need observability, ownership and boundaries that you never needed for a single box. Agents are going through the exact same transition, just about ten times faster.

## Two fleets, same shape

I see two kinds of fleets emerging, and they look very different from the outside.

**The software factory.** Coding agents in parallel, each picking up an issue, opening a pull request, fixing what CI complains about. A triage agent turning new issues and failing builds into tasks. A review agent. Maybe a release agent. The humans become something closer to tech leads and architects: they decide what gets built and sign off on the risky calls.

**The personal assistant team.** An inbox assistant, a travel assistant, a calendar assistant, a shopping assistant, a research bot. For one person, or across a whole team where everyone brings their own. The humans decide what matters, approve what goes out in their name, and answer the "should I?" questions.

From the outside, one fleet ships code and the other books flights. Under the hood, they have exactly the same shape: many agents, shared work, and a small number of humans whose judgment is the scarce resource. And they break in exactly the same ways.

## How fleets break

**Collisions.** Two coding agents fix the same bug in two different pull requests. Two assistants answer the same email. Without a way to say "this one's mine", parallelism turns into duplicated work and merge conflicts.

**Lost questions.** Ten agents in ten chat windows means ten places a question can wait unseen. An agent blocked on "ship the migration tonight or after the freeze?" will wait politely forever. Meanwhile the human thinks everything's fine because nobody's complaining.

**Invisible state.** "Where do we stand?" turns into an archaeology project across transcripts, PR descriptions and Slack threads.

**Unbounded authority.** Every agent acts with whatever credentials it was handed. Nobody remembers which ones have write access to what, and revoking one means hunting down where its key ended up.

**No memory between agents.** One agent learns that the staging database is shared, or that you never take calls before 9am. The next agent learns it again, the hard way.

## What managing a fleet actually takes

You can't manage a fleet by reading every transcript, the same way you can't run a company by reading every email. You need a control plane. Here's what I think it has to include, and how we approached each piece in Phean.

### 1. A shared ledger, written by the agents

Every agent captures work as tasks in one place, with a stable source reference so the same issue or email is never captured twice. Tasks roll up under goals, goals nest, and progress rolls up from every task underneath. The agents keep it current as a side effect of doing the work, so the ledger is a log of reality rather than a wishlist.

### 2. Claims, so parallel actually means parallel

An agent claims a task before it starts, and leaves a link back to its session. A second agent trying to claim the same task is refused and takes the next one. In a software factory, that's the difference between five agents shipping five features and five agents shipping the same one. And when an agent can't finish, it releases the task, or hands it off to a specific agent or person with a note.

### 3. One queue for human judgment

This is the heart of it. Every agent in the fleet asks on the same page: one concrete question, its options, the context, its recommendation and links to the sources (the PR, the email, the ticket) plus a link back into its conversation. You answer once. A waiting agent wakes up in seconds via webhooks or a realtime stream, others collect the answer on their next check-in, and every call stays on the record.

Fifty agents, one queue. That's the scaling trick. The number of agents can grow ten times over; the number of places a human has to look stays exactly one.

### 4. Identity and boundaries per agent

Every agent is approved by a person in the browser, with a level (Read, Write or Admin) and a lifetime, and there's no "never expires" option in that dialog, on purpose. Bots that can't open a browser get a key that only an owner or admin can issue, and either can revoke. Agents can run their own sub-agents, which act under their own names and show up nested under their parent, so you can see that "Builder 3" belongs to the factory and not to someone's side project. A sub-agent never gets more power than its parent, revoking the parent cuts off its sub-agents, and goals stay human-only no matter what level an agent has.

I spend my days at Permit thinking about agent identity and permissions, so I'll just say this: zero standing permissions and defense in depth aren't optional when your workforce can be persuaded by a cleverly worded issue description.

### 5. Shared memory

Durable facts, preferences and choices go into memory that every agent in the workspace can recall. The next agent checks before it asks a human something another agent already learned.

### 6. Loud, not long, status

The human view leads with what waits on you, what's late and what's stuck. Each task is a line on a timetable from the moment it was captured, against a red line for now. Late work is loud. A morning digest summarizes what the fleet did overnight. The goal is that a person checks in a few times a day and knows exactly where things stand.

## The software factory, concretely

To make this less abstract, here's a morning in a software factory running on Phean (an illustration, not a customer story):

1. The triage agent sweeps new issues and a failing build, and captures nine tasks. Two are skipped as duplicates because the review agent already captured them.
2. Three builder agents claim tasks. When a second builder tries to grab "Paginate the events API", it's refused and takes the next task instead.
3. One builder hits a fork in the road: ship the migration tonight, or after the freeze? It asks on the Decisions page with both options, its recommendation and a link to the PR.
4. The tech lead answers from their phone. The builder wakes up and keeps going.
5. The release agent proposes a goal for the next release. A human approves it. The agent can't do that part on its own, and that's the point.

Swap "issues" for "emails" and "builders" for "assistants", and you've got the personal assistant team. Same loop, same control plane.

## The new job title

The people who do well in this world won't be the ones writing the most code or answering the most email. They'll be the ones who operate fleets well: setting the goals, drawing the boundaries, and making fast, good calls when the agents bring them to the top of the hill.

If you're running a fleet already, or about to, start with the [agent loop](/docs/the-agent-loop), read how [sub-agents](/docs/sub-agents) work, and wire your bots to hear back with [webhooks](/docs/webhooks). Then tell me what your fleet looks like. I'm collecting war stories, and I promise to only laugh at the funny ones.
