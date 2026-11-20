---
title: Everyone is getting a personal assistant. Nobody is getting a team.
description: Personal AI assistants are going mainstream, one errand at a time. The hard part is not the next assistant. It is what happens when you have five of them, and when your whole team does too.
date: 2026-11-20
author: or-weis
tags: personal assistants, agents, teams
cover: assistants
---

For most of history, having a personal assistant was a perk reserved for executives, celebrities and the occasional very organized dentist. Someone to book the flights, answer the email, keep the calendar sane and remember that you hate the middle seat.

That perk is being democratized in real time. Assistants like Grok, Dots, Muse and Instinct, the Claude apps, and a long tail of bots people wire up themselves now book, buy, reply and plan on our behalf. It feels a lot like 2007 and the iPhone just came out: in a couple of years we won't remember how we lived without them.

But there's a catch nobody puts in the launch video. Getting *one* assistant is easy. Getting them to work as a *team* is a completely different problem. And it gets worse, fast, when it's not just you but your whole company.

## One assistant is magic. Five are a group chat.

The first assistant feels like magic because the whole world fits in its context. It reads your email, it knows your calendar, it asks you a question, you answer, done.

Then you add a second one for travel. A third for shopping. A coding agent for the side project. Maybe a research bot. Each of them is genuinely good at its errand. And now:

- **Each asks you in its own app.** The travel assistant pings you in one place, the inbox assistant in another. A question waiting for you can sit unseen for days, because it's in the tab you didn't open.
- **None of them knows what the others did.** Your inbox assistant promised Dana you'd send the deck by Thursday. Your calendar assistant has no idea, and happily booked Thursday solid.
- **You repeat yourself constantly.** You told one of them you prefer the 9am flights and the aisle seat. The next one asks again. And again.
- **Nobody owns the overall picture.** Ask "what did my assistants do this week, and what's still open?" and the honest answer is: go read five transcripts.

In the end of the day, you didn't get a team of assistants. You got five freelancers who don't talk to each other, and you became their project manager. Congratulations on the promotion.

## Now scale that to a team

Here's where it gets really interesting, and honestly where I think the next big gap is.

When a single person runs five assistants, the coordination tax lands on that one person. Painful, but contained. When a team of ten people each runs five assistants, you have fifty agents acting on behalf of ten humans, all touching the same customers, the same calendars, the same inboxes and the same projects.

The old assumptions crack in three places at once:

1. **Visibility.** A manager used to get a picture of the team's work from the tracker and the standup. Now a big chunk of the work is done by agents nobody on the team can see. The status is somewhere in fifty chat histories.
2. **Collisions.** Two assistants on two different people's behalf reply to the same customer thread. Two coding agents fix the same bug. Duplicate work used to be a human coordination failure; now it's the default, unless something prevents it.
3. **Authority.** Which agent is allowed to commit the team to a deadline? To spend money? To reply in someone's name? Each assistant acts with the authority of the person who set it up, and there's no shared place where those boundaries live.

Scaling out a team of humans took us decades of process and tooling: trackers, standups, org charts, approvals. Scaling out a team of assistants is going to happen in months, and most of those tools assume every actor is a person.

## What actually lets assistants work as a team

I don't think the answer is a bigger, smarter single assistant that does everything. Specialists win, the same way they win with people. The answer is the boring connective tissue that turns specialists into a team:

**One ledger they all report to.** Every assistant captures what it found and what it promised as tasks in the same place, with a link to the source. Duplicates are caught at capture. Now "what's open?" has one answer.

**Claims instead of hope.** Before an assistant starts on something, it claims it. The next one that wants the same task is refused and moves on. That's how you stop two bots from replying to the same customer.

**One page to ask on.** When an assistant needs you, it doesn't ping you in its own app. It records the question on one page, with the options, the context, its recommendation and a link back into its conversation. You answer from your phone; the assistant that asked picks it up in seconds.

**Shared memory.** What you told one assistant, all of them can recall. The aisle seat, the budget ceiling, "never book anything before 8am". They check before they ask you again.

**Goals that only people decide.** Assistants can propose what the team should work on. Only a person approves it. Authority stays with the humans, enforced by the system, not by a polite line in a prompt.

**One summary of the night.** A morning digest that says what your assistants finished, what's late and what waits on you today.

This is exactly what we built Phean to be: the place where personal assistants stop being five freelancers and start being a team. And because each workspace is its own team or customer, with its own members, the same shape works for one person with five assistants and for ten people with fifty.

## The real shift

The interesting part isn't the assistants themselves. Those are getting better every month, and that's someone else's arms race. The interesting part is that the unit of work is changing from "a person does a task" to "an agent does a task on behalf of a person, and occasionally needs that person's judgment".

Once you see work that way, the job of the tooling becomes obvious. Let the agents do the work, keep them from stepping on each other, and make the moments where a human is needed impossible to miss.

If you're running more than one assistant already, I'd love to hear where it hurts the most. And if you want to try the team version, [connect the assistant you already use](/docs/connect-an-agent) and see what the morning looks like with one inbox for every "should I?".
