---
name: phean-decisions
description: How to ask a person for a decision or an answer through Phean, and get it back. Use whenever you are connected to a Phean MCP server and need a human's call to go on with a task (approve, choose between options, sign off on a draft, give a fact only they have), instead of only asking in chat. Covers marking a request as a decision, writing the question, context and options, attaching links to the conversation and the sources, waiting for the answer live, and acting on it.
---

# Asking for decisions in Phean

Phean keeps every question you ask a person on their **Decisions** page, with your context, your links, and a one-click way back to you. A question asked only in chat is lost when the chat scrolls away. So whenever a task is blocked on a person, record the request in Phean, then tell them in one line.

## 1. Decide what you are asking

| You need | Mark it as | Example |
| --- | --- | --- |
| A choice, approval, or sign-off | `kind: "decision"`, with `options` | "Offer Globex 5% or escalate to their CFO?" |
| A fact or detail only they have | `kind: "question"` (the default) | "Which cost center do the offsite flights go to?" |

- A request belongs to a task. If no task fits, create one first with `capture_tasks`, then ask on it.
- A task holds one open request at a time. Asking again on the same task replaces your earlier request, which is kept as resolved. For several independent decisions, use several tasks, or subtasks (`capture_tasks` with `parentTaskId`).
- Before asking, check `recall` and `get_task` (it shows the task's earlier, answered requests), so you never ask the person twice.

## 2. Write the request

Call `request_input` with these fields:

| Field | What to put in it |
| --- | --- |
| `taskId` | The task the decision unblocks. |
| `kind` | `"decision"` or `"question"`, as above. |
| `question` | One concrete question, answerable in a word or a line. Never "thoughts?" or "let me know". |
| `context` | The facts, the trade-offs, and **your recommendation**, in a few lines. Write for someone reading it cold, days later, without the chat open. |
| `options` | For decisions: 2-5 short, mutually exclusive answers, each a few words. The person clicks one. Leave it out for open questions. |
| `multiple` | `true` when several options may apply together ("Which channels should announce the launch?"). The person ticks any number and sends them together; the options need not be exclusive then, and you need at least two. Phrase the question to match: "Pick any that apply". |
| `links` | References, as `[{ url, title, kind }]`. See below. Always include them. |
| `session` | Where the person can resume with you: `{ url, app, brief }`, or `sessionId` / `command` when you have no link. |

### Links

Each link has a `kind`, which sets how it shows on the request:

- `conversation`: a link back to this chat or thread with the person. Add one to every request when your client exposes the conversation's URL.
- `source`: the permalink of everything the question is about: the email, Slack message, calendar event, ticket, or PR.
- `doc`: a draft, spec, or file you produced or relied on. When the decision is about a draft you prepared and it has no URL of its own, attach it to the task with `attach_document` and link the `url` it returns (the phean-documents skill covers this).
- `other`: anything else.

Rules:

- Give each link a short `title`: "This chat", "Dana's email", "Draft contract".
- Use absolute `https://` links, or app links (`slack://`, `cursor://`, `vscode://`, `claude://`, ...). Phean refuses other schemes.
- Never invent a URL. If you have none, say in `context` where to look.

### Example

```json
{
  "taskId": "t_8k2m4q9w1z3x",
  "kind": "decision",
  "question": "Globex disputes invoice #4471 ($2,400) and asks for 10% off. Offer 5% to settle this week, or escalate to their CFO?",
  "context": "They have paid on time for two years and the dispute is about a late delivery we caused. I recommend offering 5%: it costs $120 and keeps the account.",
  "options": ["Offer 5% this week", "Escalate to their CFO"],
  "links": [
    { "url": "https://claude.ai/chat/5d0c2e7a-91b4-4a8e-b1f3-2c6e8a4d7f10", "title": "This chat", "kind": "conversation" },
    { "url": "https://mail.google.com/mail/u/0/#inbox/globex-4471", "title": "Globex's dispute email", "kind": "source" }
  ],
  "session": { "url": "https://claude.ai/chat/5d0c2e7a-91b4-4a8e-b1f3-2c6e8a4d7f10", "app": "Claude", "brief": "Two of three invoices are paid; Globex disputes #4471." }
}
```

## 3. Tell the person

`request_input` returns `decisionsUrl`. Tell the person in one line what is waiting and link it: "1 decision for you in Phean: the Globex discount → <decisionsUrl>". When you have several, batch them into one message.

## 4. Get the answer

- **You can wait in this session:** call `wait_for_answers` with the `taskIds` you are blocked on. It returns the moment the person answers. If it comes back with `timedOut: true`, say what you are still waiting on, then wait again or do other work. Keep `timeoutSeconds` at the default (55) unless you know your client allows longer tool calls; the maximum is 240.
- **You are moving on:** call `collect_answers` at the start of every session and before you touch work that had an open request.
- **You run as a service with an HTTPS endpoint:** register it once with `register_webhook`. Phean then POSTs a signed event the moment the person answers (topic `decisions`), so you need neither to hold a tool call open nor to poll. On that event, call `collect_answers` to take the answer. Verify every request's signature first; the phean-webhooks skill shows how.

Each answer is delivered to you once, through either tool. An answer has:

- `outcome: "answered"`: `answer` holds what the person wrote or picked; `chosenOption` names the option when it matches exactly one of yours, and `chosenOptions` lists every option picked (several, when you asked with `multiple`). A custom answer is authoritative even when it matches no option. Follow any conditions it adds.
- `outcome: "answered_elsewhere"`: the person answered you in your own conversation; read it there.

## 5. Close the loop

- Act on the decision: update or capture the follow-up tasks, do the work you can, and say what you did.
- Answering closes the request in Phean. If you got your answer some other way first, close your own request with `resolve_input`.
- Completing, releasing, or moving the task out of progress closes its open request too.
- Save a decision that will matter again with `remember` (kind `decision`), so other agents do not ask the person the same thing.

## Don'ts

- Don't bury the question in a task description or a long chat message.
- Don't ask a decision without your recommendation.
- Don't stall silently: a blocked task without a request looks like work in progress.
- Don't guess an answer to unblock yourself.
