---
title: Task management, flipped on its head
description: Task trackers were built for people to type in work for other people to read. Now agents read the email first, so the tracker should belong to them, and people should become the judgment instead of the data entry.
date: 2026-11-20
author: or-weis
tags: task management, agents
cover: blog-flip
---

Here's a slightly uncomfortable question: when was the last time your task tracker told you something you didn't already type into it yourself?

Every task management tool I've ever used, and as a software engineer turned founder I've used basically all of them, rests on the same assumption. A person notices work, a person types it in, a person updates the status, and other people read it. The tool is a very organized notebook. Useful, sure. But the notebook doesn't do anything. You do.

That assumption made perfect sense for twenty years. It's now quietly broken, and I think most of us haven't noticed yet.

## The broken assumption: humans are the first readers

Think about where work actually comes from. An email from a customer. A thread in Slack. A failing build. A calendar invite with three action items hidden in the description. A promise you made on a call, yada yada yada.

In the old stack, a human was the first reader of all of that. You read the email, you decided it's a task, you opened the tracker, you typed it in. Then, a few days later, you updated it to "in progress" for the benefit of your manager, who was reading the tracker to find out what you were doing instead of asking you.

In the new stack, the first reader is increasingly an agent. Your assistant triages the inbox before you wake up. Your coding agent reads the issue and the stack trace before you've opened the repo. The agent already knows the work exists, often already knows what to do about it, and is frequently the one doing it.

So we end up with a pretty absurd loop: the agent reads the email, tells you about it in a chat, and then you go and type it into the tracker so other humans can see it. We've turned the most expensive people in the company into the agents' secretaries.

## The flip: agents write the ledger, people make the calls

Flipping task management on its head means swapping who does what:

| | The old way | The flipped way |
| --- | --- | --- |
| Who notices work | People | Agents, from the sources they already read |
| Who writes the task | People | Agents, with a link to the source |
| Who updates status | People, for other people | Agents, as a side effect of doing the work |
| Who does the work | People | Agents, mostly |
| What people do | Data entry, and the work | Approve goals, answer questions, make the calls |

The tracker stops being a notebook for humans and becomes a ledger for agents. And people stop being data entry and start being the judgment.

That's not a minor UX tweak. It changes what the tool has to be good at.

## What a ledger for agents actually needs

If agents are the ones writing, the tool needs properties that human trackers never had to care about:

**Idempotent capture.** Two agents reading the same email shouldn't create two tasks. In Phean, every captured task carries a stable source reference (the message link, the thread id, the event id), and a second capture of the same thing is reported back as a duplicate instead of written twice. Humans dedupe in their heads. Agents need it in the protocol.

**Exclusive claims.** Two humans rarely start the same ticket at the same minute. Two agents absolutely will. So an agent claims a task before it starts, with a link back to its session, and a second agent trying to claim it is refused and moves on. No standups needed to figure out who's on what.

**A hard line between proposing and deciding.** This is the one I care about most. Agents are fantastic at proposing: "these twelve tasks look like a goal called *Q1 launch*, want it?" They should not be the ones deciding what the company commits to. In Phean an agent can propose a goal, but only a person can approve, achieve or abandon one, and the server enforces that rule, not the agent's good manners. Your agent is really easy to persuade to do silly things. The server isn't.

**Questions as first-class objects.** In a human tracker, a question is a comment that someone may or may not read. In a flipped one, a question is the most important thing on the screen, because it's the one place a human is actually needed. So it gets structure: one concrete question, its options, the context and the agent's recommendation, and links to the sources and back to the conversation.

**Loud lateness.** When nobody is manually updating status, slipping work can't hide behind a stale "in progress". Overdue and stuck items have to surface on their own, without anybody running a search.

## What the human screen becomes

Once you flip it, the screen a person looks at gets much shorter and much more interesting. It's no longer "here are 140 tasks, please groom them". It's:

1. Here are the decisions waiting on you.
2. Here are the goals your agents proposed.
3. Here's what's late or stuck.
4. Here's what got done while you were asleep.

That's the whole job. Everything else is the agents rolling the boulder.

The funny side effect is that the tracker gets more accurate, not less. Status updates written by humans are aspirational at best ("90% done" for three weeks, we've all been there). Status written by the agent that's actually doing the work is just a log of what happened.

## Isn't this just automation on top of Jira?

Terrific question, and the honest answer is: you can bolt agents onto an existing tracker, and plenty of people do. But you inherit the tracker's assumptions. There's no notion of which agent holds what, no structured way for an agent to ask a human and get the answer delivered back to it, no shared memory across agents, and the permission model assumes every writer is a person with accountability. Agents aren't. You and your agent are not the same.

It's a bit like putting an engine on a horse carriage. It will move. It's just not a car.

## Where to start

If you want to feel the flip, connect a single agent you already use, point it at your inbox or your issues, and let it capture a day of work into a Phean workspace. Then look at what's left for you on the overview. My bet is it's a handful of decisions and nothing you have to type.

- [The agent loop](/docs/the-agent-loop): how agents sync, capture, triage, claim, ask and remember.
- [Concepts](/docs/concepts): goals, tasks, stages and memory.

I'd genuinely love pushback on this one. Tell me where the flip breaks for your team.
