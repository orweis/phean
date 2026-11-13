---
title: Skills
description: The four installable Agent Skills that teach agents Phean's decisions, handoffs, webhooks and documents, and how to install them.
---

Phean's server instructions teach every connected agent the loop in short. Four installable skills go deeper, with worked examples, and load only when an agent needs them. They live in the repository's `skills/` folder.

## The skills

### phean-decisions

`skills/phean-decisions/SKILL.md` teaches an agent how to ask you for decisions through Phean:

- when to mark a request `kind: "decision"` (with options) and when `"question"`;
- how to write the question, the context and its recommendation;
- which links to attach (`conversation`, `source`, `doc`);
- how to tell you, then wait for or collect your answer, and act on it.

See [Decisions](/docs/decisions).

### phean-webhooks

`skills/phean-webhooks/SKILL.md` is for bots that receive webhooks:

- registering the endpoint and keeping the secret;
- verifying `Phean-Signature`, with Node and Python verifiers that Phean's tests run against real signatures;
- rejecting replays and de-duplicating retried events;
- what to do with each event;
- listening over the realtime WebSocket when there is no public endpoint.

See [Webhooks](/docs/webhooks) and [Realtime events](/docs/realtime).

### phean-handoffs

`skills/phean-handoffs/SKILL.md` teaches an agent to pass work on without dropping it:

- operators: claim before working, and leave a task alone while another agent or a person works on it;
- the delegation states (`handing_off`, `picking_up`, `returned`) and what ends each;
- when to hand off (and when a decision with `request_input` is the right move instead), with `hand_off_task` to an agent, a person or anyone;
- writing a handoff note someone with no memory of the session can act on;
- finding work handed to it (`list_tasks` with `claimed: "handed_to_me"`), picking it up with `claim_task`, and letting a task go with `release_task`.

See [Operators and handoffs](/docs/concepts#operators-and-handoffs).

### phean-documents

`skills/phean-documents/SKILL.md` teaches an agent documents:

- when to attach one (a draft behind a decision, material with no URL, a handoff note);
- the formats Phean shows and how;
- linking a draft from a decision request;
- reading a task's documents before working, and editing with `expectedVersion`;
- what never to put in a document.

See [Documents](/docs/documents).

## Install for Claude Code

From a checkout of the repository, copy the skills into your personal skills folder:

```bash
mkdir -p ~/.claude/skills && cp -r skills/phean-decisions skills/phean-handoffs skills/phean-webhooks skills/phean-documents ~/.claude/skills/
```

To share them with everyone working in a project, copy them into `.claude/skills/` inside that project instead:

```bash
mkdir -p .claude/skills && cp -r /path/to/phean/skills/phean-decisions /path/to/phean/skills/phean-handoffs /path/to/phean/skills/phean-webhooks /path/to/phean/skills/phean-documents .claude/skills/
```

Install only the ones your agent needs: a chat agent that asks you things wants phean-decisions and phean-documents; any agent that shares work with others wants phean-handoffs; a bot that runs as a service wants phean-webhooks.

## Other clients

Other clients that support Agent Skills take the same folders. Each skill is one directory with a `SKILL.md` whose frontmatter names it and says when to use it. Put the directories wherever your client reads skills from.

## Keeping them in step

The skills are checked against the server by Phean's own tests: tool names, request kinds, fields, limits, the example request, and the webhook verifiers. When you update Phean, copy the skills again so your agents read the current version.
