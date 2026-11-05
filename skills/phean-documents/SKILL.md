---
name: phean-documents
description: How to attach, read, edit and hand off documents in Phean. Use whenever you are connected to a Phean MCP server and produce something a person should read or judge (a draft email, a proposal, a plan, an analysis, a diagram), need to hand a task to another agent or pause it with its context, or pick up a task someone else started. Covers the formats Phean shows, attaching to tasks and goals, linking a draft from a decision request, reading a task's documents before working, editing without overwriting a person's changes, and what never to put in a document.
---

# Documents in Phean

A document is a file attached to a task or a goal. People read it in Phean (Markdown renders, with Mermaid diagrams) and can edit it there; agents read it with `get_document`. Documents carry the context a link cannot: the draft you wrote, the notes that let the next agent carry on, the analysis behind a decision.

## When to attach one

| You have | Do this |
| --- | --- |
| A draft for a person to judge (an email, an offer, a plan) | Attach it to the task, then link it from your `request_input` (kind `doc`) so the decision and the draft sit together. |
| Material with no URL (it is in your context, not on the web) | Attach it, rather than pasting a wall of text into a description or a question. |
| Work you are pausing or handing over | Attach a short handoff note (done, next, where things are) before `release_task`. |
| A task to pick up | Read its documents first: `get_task` lists them, `get_document` reads one. |

When there is a real link to the material (a Google Doc, a PR, a ticket), link that instead, with `update_task` `addLinks`.

## Formats

| `format` | Use it for | How Phean shows it |
| --- | --- | --- |
| `markdown` | Drafts, notes, plans, reports. The default. | Rendered; fenced ```` ```mermaid ```` blocks draw as diagrams. |
| `mermaid` | One diagram on its own. | Drawn. |
| `text`, `json`, `csv`, `yaml` | Plain or structured data. | As text, in a monospace block. |
| `html` | Markup you need to keep as written. | As source, never rendered. |
| `pdf`, `png`, `jpeg`, `gif`, `webp` | Files you were given or produced. | Images inline; PDFs open in the browser. |

Text formats take their text in `content`. PDFs and images take their bytes as base64 in `contentBase64`, up to 5 MB.

## Attach

Call `attach_document`:

| Field | What to put in it |
| --- | --- |
| `title` | What it is, in a few words: "Draft reply to Globex", "Handoff: payroll accrual". |
| `format` | One of the formats above; `markdown` unless you have a reason. |
| `summary` | One or two sentences on what is in it and why it matters, so others can tell without opening it. |
| `taskId` | The task it belongs to. |
| `goalId` | The goal, when it is about a goal rather than one task. |
| `content` / `contentBase64` | The text, or the bytes as base64. |

It returns the `document` (with its `id` and `version`) and a `url` people can open.

### Example: a draft behind a decision

```json
{
  "title": "Draft reply to Globex",
  "format": "markdown",
  "summary": "The reply offering 5% on invoice #4471 if they pay this week, for Dana to approve.",
  "taskId": "t_8k2m4q9w1z3x",
  "content": "Hi Priya,\n\nThanks for flagging the late delivery on order 1182. We would like to make it right: if you settle invoice #4471 this week, we will take 5% off ($120).\n\nBest,\nDana"
}
```

Then ask, linking the draft: `request_input` with `kind: "decision"`, options such as "Send as drafted" and "Hold it", and in `links` `{ "url": "<the url attach_document returned>", "title": "Draft reply", "kind": "doc" }`.

## Read

- `get_task` lists a task's documents (id, title, format). `list_documents` finds them by task, goal, or words in the title or summary.
- `get_document` returns the metadata (`version`, who changed it last) and the `content` (or `contentBase64`).

## Edit

- `update_document` changes the content (a new version), the title, the summary, or the task or goal it is attached to. Only the fields you pass change.
- Always pass `expectedVersion`: the version you read. If a person edited it since, Phean refuses your update instead of overwriting their change; read it again and apply your edit to the latest.
- Agents edit and delete only documents they attached, or ones a person wrote. To change another agent's document, attach your own version instead.
- `delete_document` removes one that is wrong or obsolete.

## Don'ts

- Never put secrets, tokens, passwords or keys in a document. People and every agent in the workspace can read it.
- Don't attach the same draft twice; update it, so the history stays in one place.
- Don't hide the question inside the document: the decision itself still goes in `request_input`, short and answerable.
