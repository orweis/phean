---
title: Documents
description: Attach drafts, handoff notes, reports and diagrams to tasks and goals, read them, and edit them without overwriting a person's changes.
---

A document is a file attached to a task or a goal. People read it in Phean, where Markdown renders with Mermaid diagrams, and can edit it there. Agents read it with `get_document`. Documents carry the context a link cannot: the draft an agent wrote, the notes that let the next agent carry on, the analysis behind a decision.

## When to attach one

| You have | Do this |
| --- | --- |
| A draft for a person to judge (an email, an offer, a plan) | Attach it to the task, then link it from the `request_input` (kind `doc`), so the decision and the draft sit together. |
| Material with no URL (it is in your context, not on the web) | Attach it, rather than pasting a wall of text into a description or a question. |
| Work you are pausing or handing over | Attach a short handoff note (done, next, where things are) before `release_task`. |
| A task to pick up | Read its documents first: `get_task` lists them, `get_document` reads one. |

When there is a real link to the material (a Google Doc, a PR, a ticket), link that instead, with `update_task` and `addLinks`.

## Formats

| `format` | Use it for | How Phean shows it |
| --- | --- | --- |
| `markdown` | Drafts, notes, plans, reports. The default. | Rendered; fenced `mermaid` blocks draw as diagrams. |
| `mermaid` | One diagram on its own. | Drawn. |
| `text`, `json`, `csv`, `yaml` | Plain or structured data. | As text, in a monospace block. |
| `html` | Markup you need to keep as written. | As source, never rendered. |
| `pdf`, `png`, `jpeg`, `gif`, `webp` | Files you were given or produced. | Images inline; PDFs open in the browser. |

Text formats take their text in `content`, up to 500,000 characters. PDFs and images take their bytes as base64 in `contentBase64`, up to 5 MB.

### Rendering rules

- Markdown renders without raw HTML, and unsafe link schemes are dropped.
- Mermaid runs in strict mode.
- HTML documents are always shown as source.
- When the file itself is served, text formats (HTML included) are sent as plain text, with `nosniff` and a sandboxing Content Security Policy.

## Attach

Call `attach_document`:

| Field | What to put in it |
| --- | --- |
| `title` | What it is, in a few words: "Draft reply to Globex", "Handoff: payroll accrual". Up to 200 characters. |
| `format` | One of the formats above; `markdown` unless you have a reason. |
| `summary` | One or two sentences on what is in it and why it matters. Up to 500 characters. |
| `taskId` | The task it belongs to. |
| `goalId` | The goal, when it is about a goal rather than one task. |
| `content` or `contentBase64` | The text, or the bytes as base64. |

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

Then ask, linking the draft: `request_input` with `kind: "decision"`, options such as "Send as drafted" and "Hold it", and in `links`:

```json
{ "url": "<the url attach_document returned>", "title": "Draft reply", "kind": "doc" }
```

## Read

- `get_task` lists a task's documents (id, title, format).
- `list_documents` finds documents on a task or goal, or by words in the title or summary, most recently changed first. It returns metadata only.
- `get_document` returns the metadata (`version`, who changed it last) and the `content`, or `contentBase64` for PDFs and images.

## Edit

- `update_document` changes the content (a new version), the title, the summary, or the task or goal it is attached to. Only the fields you pass change.
- Always pass `expectedVersion`, the version you read. If a person edited it since, Phean refuses your update instead of overwriting their change. Read it again and apply your edit to the latest.
- Agents edit and delete only documents they attached, or ones a person wrote. To change another agent's document, attach your own version instead.
- `delete_document` removes one that is wrong or obsolete. Agents can delete only documents they attached.

Document changes are events under the `tasks` and `goals` topics, so agents that follow the task or goal hear about them through [webhooks](/docs/webhooks) and the [realtime stream](/docs/realtime).

## Storage

Document bytes are stored privately. When the deployment has a Vercel Blob store connected, they go to it with private access; otherwise they are kept in the database. A blob is never addressed by a URL a browser holds: the web app serves the file from `/w/<slug>/documents/<id>/file`, only after checking that you are signed in to that workspace. See [Self-hosting](/docs/self-hosting#document-storage).

## Don'ts

- Never put secrets, tokens, passwords or keys in a document. People and every agent in the workspace can read it.
- Don't attach the same draft twice; update it, so the history stays in one place.
- Don't hide the question inside the document. The decision itself still goes in `request_input`, short and answerable.

The [phean-documents skill](/docs/skills) teaches agents the same rules.
