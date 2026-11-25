---
title: Decisions
description: How an agent asks you for a call with request_input, how you answer on the Decisions page, and how the answer gets back to the agent.
---

In Phean, a **decision** means one thing: an agent's request for a person's call. A question asked only in chat is lost when the chat scrolls away. A request recorded with `request_input` waits on your **Decisions** page with the agent's context, its links, and a one-click way back into its conversation, until you answer.

## Question or decision

| The agent needs | `kind` | Example |
| --- | --- | --- |
| A choice, approval or sign-off | `"decision"`, with `options` | "Offer Globex 5% or escalate to their CFO?" |
| A fact or detail only you have | `"question"` (the default) | "Which cost center do the offsite flights go to?" |

A request belongs to a task. If no task fits, the agent captures one first. A task holds one open request at a time: asking again on the same task replaces the agent's earlier request. For several independent decisions, the agent uses several tasks or subtasks.

## The request

`request_input` takes these fields:

| Field | What goes in it |
| --- | --- |
| `taskId` | The task the request unblocks. |
| `kind` | `"decision"` or `"question"`. |
| `question` | One concrete question, answerable in a word or a line. Up to 1,000 characters. |
| `context` | The facts, the trade-offs, and the agent's recommendation, for someone reading it cold days later. Up to 5,000 characters. |
| `options` | For decisions: short, mutually exclusive answers. The guidance asks for 2 to 5; Phean accepts up to 8, each up to 200 characters. You can always write your own answer instead. |
| `multiple` | `true` when several options may apply together. Needs at least two options. |
| `recommended` | The option the agent recommends, by its position in `options` counted from 0; with `multiple`, an array of the positions it suggests ticking. You see it marked **Recommended** (suggested picks come ticked), and in Quick Decisions you accept it with one swipe. |
| `links` | Up to 10 references, as `[{ url, title, kind }]`. |
| `session` | Where you can resume with the agent: `{ url, app, brief }`, or `sessionId` or `command` when there is no link. |

### Multiple answers

With `multiple: true`, you tick any number of options and send them together, and the agent gets every one in `chosenOptions`. The options need not be exclusive then. The question should read that way: "Which channels should announce the launch? Pick any that apply."

### Links

Each link has a `kind`, which sets how it shows on the request:

- `conversation`: back to the chat or thread with you. Agents add one to every request when their client exposes the conversation's URL.
- `source`: the permalink of what the question is about: the email, Slack message, calendar event, ticket or PR.
- `doc`: a draft, spec or file. When the decision is about a draft with no URL of its own, the agent attaches it with `attach_document` first and links the `url` it returns (see [Documents](/docs/documents)).
- `other`: anything else.

Links use `https://` or an app scheme (`slack://`, `cursor://`, `vscode://`, `claude://` and a few others). Phean refuses other schemes. Agents are told never to invent a URL; if they have none, they say in `context` where to look.

### Session and the way back

The `session` is how you get back to the agent. On the overview and the Decisions page, **Resume in Claude** (or the agent's app, from `session.app`) leads the request's entry when the agent left a link. `session.app` names where you reach the conversation (Slack, Claude, Cursor), never the bot itself. Without a link, **Resume** lists the session id and resume command, ready to copy.

## A complete example

```json
{
  "taskId": "t_8k2m4q9w1z3x",
  "kind": "decision",
  "question": "Globex disputes invoice #4471 ($2,400) and asks for 10% off. Offer 5% to settle this week, or escalate to their CFO?",
  "context": "They have paid on time for two years and the dispute is about a late delivery we caused. I recommend offering 5%: it costs $120 and keeps the account.",
  "options": ["Offer 5% this week", "Escalate to their CFO"],
  "recommended": 0,
  "links": [
    { "url": "https://claude.ai/chat/5d0c2e7a-91b4-4a8e-b1f3-2c6e8a4d7f10", "title": "This chat", "kind": "conversation" },
    { "url": "https://mail.google.com/mail/u/0/#inbox/globex-4471", "title": "Globex's dispute email", "kind": "source" }
  ],
  "session": { "url": "https://claude.ai/chat/5d0c2e7a-91b4-4a8e-b1f3-2c6e8a4d7f10", "app": "Claude", "brief": "Two of three invoices are paid; Globex disputes #4471." }
}
```

`request_input` returns the task and a `decisionsUrl`. The agent tells you in one line what is waiting and links it, batching several requests into one message.

## Answering

The Decisions page (`/w/<slug>/decisions`) shows what waits, with context, options and links, and what was answered, with whether the asking agent has picked the answer up. Requests also appear on the overview.

- **A decision with options**: click an option. On a request that takes several, tick them and **Send**.
- **Your own answer**: **Other answer** (or **Answer here** for a question, **Decide here** for a decision without options) opens a short reply.
- **Answered in the conversation**: in the entry's ⋯ menu. Use it only when you already answered the agent in its own conversation. It asks you to confirm.

After you answer, the status region says what was sent and offers **Undo**. Undo takes the answer back and reopens the question exactly as it was asked, as long as the agent has not collected the answer yet. Once the agent has it, tell it in its conversation if your answer changed.

Not ready to answer one yet? **Snooze** it (or press **S** with it selected) and it moves to the back of the queue, behind everything asked before you snoozed it. The agent's request is unchanged and still waits for you; **Undo** puts it back where it was. A snoozed request says so next to when it was asked.

### Keyboard

On the Decisions page and the overview, one request is always selected.

| Key | Does |
| --- | --- |
| `1` to `9` | Pick the selected request's option (or tick it, where several may be picked). |
| `Enter` | Send the ticked options, where a request takes several. On the selected entry itself, open its task. |
| `J` | Next request. |
| `K` | Previous request. |
| `?` | Show all keyboard shortcuts. |

Keys never fire while you are typing in a field.

## Quick Decisions

**Quick Decisions** (`/w/<slug>/decisions/quick`) shows the requests that wait one card at a time, made for a phone, on the whole screen without the workspace's header and tabs (✕ takes you back to Decisions). On a phone the Decisions page leads with it (**Start**); on a wider screen it is the **Quick Decisions** button at the top of the page. A link to one request, such as a notification's, still opens that request on the Decisions page.

- Pipeline decisions come first, then the rest longest waiting first; snoozed ones wait at the back. A pipeline decision that names someone else (another person, or owners and admins) is left out of your queue; it stays on the Decisions page, which says who it waits on.
- A card that has just arrived ignores taps and keys for a moment, so a double tap or a held key never answers the next one.
- Tap an option to answer it. The option the agent recommends is filled and marked **Recommended**; on a request that takes several, its recommendations start ticked and marked **Recommended**, and **Send** under the card counts your picks.
- **Swipe right** sends the agent's recommended answer, or the first option when it recommends none (or your picks); the colour behind the card says which, "Recommended:" or "First option:", above the answer; **swipe left** snoozes. The card follows your finger either way, and what lies behind it says what letting go will do; past the point where letting go acts, its mark fills and your phone taps once. The **Snooze**, **Context** and named answer buttons under the card do the same without a swipe.
- **Read full context** opens the agent's context, the task's files and the request's links, with the answers pinned at the bottom so you can answer while reading. A file opens in place, with a way back to the decision.
- **Write another answer** opens a short reply with a few phrases to start from; a question with no options has its field right on the card.
- When only requests you snoozed are left, the queue rests and says so, with **Show snoozed again**. Your progress is kept for the day, so closing and coming back carries on where you were, and the end says how many goals still wait for your approval.
- After each answer the status region offers **Undo**, as on the Decisions page; a pipeline's answer cannot be taken back. When nothing is left, the last card lists what you answered, each with Undo.

With a keyboard: `→` sends the recommended answer (or the first option), `←` or `S` snoozes, `1` to `9` pick an option, `C` opens the context, and `Esc` goes back from the context or a file to the card.

## How the agent gets the answer

Each answer is delivered to the asking agent once, through either of two tools:

- **`wait_for_answers`** blocks until you answer one of its requests (only on `taskIds`, if given). `timeoutSeconds` defaults to 55, because some clients give up on a tool call after 60 seconds, and can go up to 240. If nobody answered in time it returns `timedOut: true` with `stillOpen`; the agent says what it is still waiting on, then waits again or does other work.
- **`collect_answers`** returns the answers since it last collected, oldest first. Agents call it at the start of every session and before acting on work that had an open request.

A bot with an HTTPS endpoint can be told the moment you answer, through a [webhook](/docs/webhooks) (topic `decisions`) or the [realtime stream](/docs/realtime). It still takes the answer through `collect_answers`, which marks it delivered.

### Outcomes

Two outcomes reach the agent:

- **`answered`**: `answer` holds what you wrote or picked. `chosenOption` names the option when the answer matches exactly one, and `chosenOptions` lists every option picked. A custom answer is authoritative even when it matches no option.
- **`answered_elsewhere`**: you marked it answered in the agent's own conversation; the agent reads it there.

A request can also end without reaching the agent as an answer: the agent closes its own with `resolve_input` once it has the answer some other way (`resolved`), and completing, releasing, or moving the task out of progress closes it (`closed`). Every closed request stays on the task's history. On the Decisions page, settled requests sit under **Answered**, newest first, each as one line: the question, what was picked, when, and whether the agent has it yet. Open a line for the full record (every option offered, the written answer, the links), or open its task in the side peek. Past the latest eight, the rest fold under **Show earlier answers**.

If you take an answer back before the agent collects it, a listening bot gets a `task.input_retracted` event, the question is open again, and `collect_answers` returns nothing for it until you answer again.

## After the answer

The agent acts on it: it updates or captures follow-up tasks, does the work it can, and says what it did. A choice that will matter again goes into memory with `remember` (kind `decision`, shown as "Choice"), so other agents do not ask you the same thing.

The [phean-decisions skill](/docs/skills) teaches agents all of this with the same example.
