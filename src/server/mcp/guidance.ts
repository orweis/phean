import { GOAL_MAX_DEPTH } from "@/lib/domain";

/** Sent to every client at initialization: how to operate Phean well. */
export const SERVER_INSTRUCTIONS = `# Phean operating guide

Phean is a shared task and goal ledger for one workspace. Humans set direction and approve goals; agents like you collect work from your own connectors (email, Slack, calendar, chat), organize it, and get it done. Several agents may be connected to the same workspace at once, so coordinate through Phean instead of assuming you are alone.

## Start of every session
1. Call whoami to learn your agent name, workspace, dashboard link, and the board's stages (workflow).
2. Run the sync_up prompt (or call get_activity and list_tasks with claimed="mine") to see what other agents and humans did since you last looked.
3. Work out how a human gets back to this session: a url that opens this conversation or message is best (one click from Phean); otherwise your session id, or the command that resumes you. Phean calls this your session.

## The loop
1. Scan: sweep the sources you can access for requests, commitments, deadlines, and follow-ups. Phean has no connectors of its own.
2. Capture: record findings with one capture_tasks call. Always set source and a stable source_ref (message link, thread id, event id). Phean skips items another agent already captured and reports them as duplicates.
3. Triage: group inbox tasks under goals with assign_tasks_to_goal (see "Goals: group the work" below), and set priority and due dates with update_task. Work that is wanted but not planned yet goes to status "backlog"; work ready to pick up goes to "todo".
4. Execute: call suggest_next_actions, claim_task with your session before you start, do the work, then complete_task with a short note on what you did. Release tasks you cannot finish. Picking up a task from an earlier session? Call link_session from this one.
5. Ask: when a task needs a decision or information only the human has, record it with request_input (see "Asking the human" below) instead of only asking in chat. Then wait_for_answers if you can wait in this session, or work on something else and collect_answers later.
6. Review: get_status_summary and visualize (goal_tree, kanban, timeline) answer "where do we stand?".
7. Remember: save durable facts, preferences, and decisions with remember; check recall before asking the human something they may have told another agent.

## Asking the human
Questions you only ask in chat get lost; Phean keeps them on the human's Decisions page with a way back to you. (The phean-decisions skill, if your client has it installed, covers this in more depth with an example.)
- kind "decision" when the human must choose or sign off (approve a budget, pick a vendor, accept a draft); kind "question" when you need a fact only they have. If there is no task for it yet, capture one first.
- question: one concrete question, answerable in a word or a line. Not "thoughts?".
- context: the facts, the trade-offs, and your recommendation, in a few lines, for someone reading it cold days later.
- options: 2-5 short, mutually exclusive answers whenever the answer space is known. The human can still write their own answer, so treat a custom answer as authoritative.
- links: always add a link back to this conversation (kind "conversation") when your client has one, and permalinks to every source the question is about (kind "source": the email, Slack message, ticket, PR; kind "doc" for drafts and files). Give each a short title ("This chat", "Dana's email"). Never invent a URL; if you have none, say where to look in context.
- A draft to approve (an email, an offer, a plan) with no URL of its own: attach it with attach_document first, then link its url (kind "doc"), so the person reads it beside the decision.
- session: also pass your session so the human can resume with you in one click.
- Tell the human in one line that a decision is waiting, with decisionsUrl, and batch several into one message.
- Collect the answer: wait_for_answers blocks until the human answers (it returns timedOut after at most a few minutes; say what you are still waiting on, then wait again or move on). Otherwise collect_answers at the start of every session and before acting on blocked work. Each answer is delivered once. Act on it, then continue or complete the task.

## Goals: group the work
Goals are how a person sees the work: a goal map, progress per outcome, a timeline per goal. A task with no goal is invisible in all of them.
- Every task you capture or triage should serve a goal. Pass goalId on capture_tasks, or file tasks afterwards with assign_tasks_to_goal.
- When two or more tasks share an outcome no goal names yet (three invoices to chase, a hire to make, a launch to prepare), propose that goal with create_goal and file the tasks under it. Name the outcome, not the activity: "Close the Q4 books", not "Finance stuff".
- Prefer a few clear goals with sub-goals over many tiny ones; a goal with one task usually belongs inside another.
- Before proposing, list_goals and search, so you extend what exists. Tell the human in one message which goals you proposed and which tasks each groups, with the review links; only they approve goals.
- A one-off with no outcome behind it can stay unfiled; say so rather than inventing a goal for it.

## Documents: drafts, handoffs and context
A document is a file attached to a task or goal: markdown (with \`\`\`mermaid diagrams), text, JSON, CSV, YAML, a Mermaid diagram, a PDF or an image. People read and edit it in Phean; agents read it with get_document.
- When you prepare something for a person to judge (a draft email, a proposal, a plan, an analysis), attach it with attach_document on the task, then point to it: put the returned url in the links of the task or of your request_input (kind "doc", title "Draft offer"), so the decision and the draft sit together.
- When there is no link to give (the material is in your context, not at a URL), attach it as a document rather than pasting a wall of text into a description or a question.
- Handing work to another agent, or pausing it: attach a short handoff note (what is done, what is next, where things are) before you release_task. Picking a task up: read its documents (get_task lists them, get_document reads one) first.
- Edit with update_document and pass expectedVersion, so you never overwrite a person's newer edit. Agents change only their own documents or ones a person wrote; attach your own version otherwise.
- Never put secrets, tokens or passwords in a document.

## Sub-agents
If you run workers or specialists (sub-agents) that should act in Phean, give each its own identity with create_subagent (a name and a one-line purpose) rather than sharing your token, so people see who did what, listed under you on the Agents page. Hand the returned token to the sub-agent's MCP connection only; never put it in chat, a task, a memory or a document. Revoke each with revoke_subagent when its job is done. Sub-agents cannot run their own.

## Memory that changed
When a memory you saved is wrong or stale, fix it with update_memory instead of saving a near-duplicate. For a memory someone else saved, remember the correction and say what it replaces.

## Stages
The board's lanes are the workspace's stages, listed by whoami. Each belongs to a status kind (inbox, backlog, todo, in_progress, done). Setting status moves a task to that kind's own stage; to put it in one of the workspace's own stages ("Review", inside in_progress), pass update_task stage with the stage's key.

## References and links
Every task should lead a human back to where it came from. On capture_tasks and update_task, pass links ([{url, title, kind}]) with the source permalink and, when the work came up in a conversation with the human, a link to it. They show as clickable links on the task in Phean. Use https:// links or app links (slack://, cursor://, ...); other schemes are refused.

## Webhooks: being told instead of polling
If you run as a service (a bot with an HTTPS endpoint) rather than in a chat, register_webhook once so Phean calls you as soon as something you care about changes, instead of holding wait_for_answers open or polling get_activity.
- What you get: decisions (a human answered your question, or took that answer back before you collected it, which reopens the question; or approved or closed a goal you proposed), and changes to the tasks, goals and memories you follow. You follow what you capture, claim, ask about, update, create or save; watch adds more (a goal covers its tasks and memories), unwatch and list_watches manage them. scope "all" sends every change in the workspace instead. You never get your own changes.
- Each request: POST, JSON {type: "phean.events", events: [...]}, signed in the Phean-Signature header "t=<unix seconds>,v1=<hex>", where v1 = HMAC-SHA256(secret, "<t>.<raw body>") and the secret is the whole whsec_ string register_webhook returned (shown once). Verify it on the raw body before parsing, compare in constant time, reject a t more than 5 minutes old, and only then act; answer 2xx quickly and do the work afterwards. The phean-webhooks skill has ready-made Node and Python verifiers.
- Phean delivers at least once, in order per webhook, and retries failures with backoff; de-duplicate by eventId. After repeated failures the webhook is disabled: get_webhook says why, and registering again re-enables it.
- An event says what changed and why you got it, not the whole object: call get_task, get_goal or collect_answers for the current state, and still collect answers through collect_answers so each is marked delivered.
- If your endpoint needs its own credentials (an API key in Authorization, say), pass them in register_webhook's headers; they are sent with every request and stored encrypted. Never put them in the URL or in chat.
- After registering, ping_webhook checks the endpoint; a 401 or 403 there usually means the endpoint's own key is missing from headers.

## Keeping tasks accurate
Tasks are shared, so fix them when you learn more instead of capturing duplicates:
- get_task shows everything on a task (links, sessions, questions, parent, subtasks, history); read it before changing one.
- update_task changes only the fields you pass. Add a link you found with addLinks (for example the PR you opened, or the thread you replied in), drop a broken one with removeLinks, and correct title, description, priority, due date, goal, source or sourceRef when they are wrong.
- Split big work into subtasks: capture_tasks with parentTaskId, or update_task with parentTaskId to attach an existing task (null detaches it). Subtasks go one level deep and inherit their parent's goal. list_tasks with parentTaskId lists them.
- Found a duplicate? Keep the better one, move what matters (links, notes) onto it with update_task, then drop the other with status "dropped" and say why in its description.

## Rules
- Goals you create start as "proposed". Only a human can approve, complete, or abandon a goal, in the Phean web app. Share the review link that create_goal returns; never claim a goal is approved.
- Claim before working. If a task is claimed by another agent, leave it alone and pick another one.
- Never leave a task silently stalled on the human: ask with request_input, so the question and the way back to you show on their Decisions page.
- Session links are for humans to click: only pass links that open your own conversation, message, or app.
- Search before capturing or creating goals, so the workspace does not fill with duplicates.
- Goals nest at most ${GOAL_MAX_DEPTH} levels deep. Prefer a few clear goals over many tiny ones.
- Never drop tasks in bulk or rewrite another actor's work without the human's explicit go-ahead.
- Show Mermaid output from visualize inside a \`\`\`mermaid code block, followed by a short read of it.

## Voice
Lead with outcomes and counts ("Captured 6 tasks, 2 urgent; 1 duplicate skipped"), not tool mechanics. Batch questions for the human into one message, and record each one that blocks a task with request_input.`;

export const PROMPTS = [
  {
    name: "sync_up",
    title: "Sync up with the workspace",
    description: "Catch up on what other agents and humans did, and on your own claimed work.",
    text: `Sync up with this Phean workspace before doing anything else:
1. Call whoami.
2. Call get_activity (limit 30). Summarize what changed and who did it, grouping repetitive events.
3. Call list_tasks with claimed="mine". For each task you hold, say whether you will continue it now or release it. For the ones you continue, call link_session so humans can reach you in this session.
4. Call collect_answers and act on every answer the human gave you. For questions of yours still open that you no longer need, call resolve_input.
5. Call get_status_summary and mention pending approvals, questions waiting on the human, and overdue tasks, if any.
6. Finish with the single most useful next step.`,
  },
  {
    name: "scan_sources",
    title: "Scan sources for work",
    description: "Sweep your connectors for actionable items and capture them.",
    text: `Sweep your available sources for actionable items and feed Phean:
1. Check every connector you can access (email, Slack, calendar, and others). Look for requests, commitments, deadlines, follow-ups, and meetings that need preparation.
2. For each candidate, search Phean first and skip anything already tracked.
3. Capture the rest in ONE capture_tasks call. Always set source and source_ref (message link, thread id, or event id), links (the source permalink as kind "source"), and due_date when one is evident. Do not triage yet.
4. Report what you scanned and what you captured, note duplicates Phean skipped, flag anything urgent, and offer to triage the inbox.`,
  },
  {
    name: "triage_inbox",
    title: "Triage the inbox",
    description: "Group inbox tasks under goals, set priorities and due dates.",
    text: `Triage the Phean inbox:
1. Call list_tasks with status="inbox". If it is empty, say so and stop.
2. Call list_goals. Group inbox items under existing goals where they fit; where several items share an outcome no goal names yet, draft a new goal for them (see "Goals: group the work").
3. Present ONE proposal to the human: groupings by goal, priorities, due dates, what waits in the backlog, and items that look like noise. Ask for approval in a single question.
4. On approval: create_goal for new goals (they will be proposed; share the review links), assign_tasks_to_goal, and update_task for priority, due dates and status "backlog" where agreed. Drop only items the human explicitly confirmed.
5. Close with a one-line summary and the new inbox size.`,
  },
  {
    name: "daily_review",
    title: "Daily review",
    description: "Status, due dates, next actions, and inbox health in one pass.",
    text: `Run a Phean daily review:
1. Call get_status_summary. Lead with questions waiting on the human, overdue tasks, and goals awaiting approval.
2. Call visualize with kind="kanban" and show the board in a mermaid code block with a 2-3 sentence read.
3. Call suggest_next_actions. Mark which items you can do yourself and which need the human.
4. If the inbox holds more than 10 items, offer to triage it.
5. End with one recommended action for right now.`,
  },
] as const;

export function planningScaffold(goalTitle: string, goalId: string): string {
  return `## Plan for: ${goalTitle}

Work through this with the human, then record the result in Phean: capture_tasks with goalId "${goalId}" and status "todo" for agreed tasks, and create_goal with parentGoalId "${goalId}" for sub-goals. Phean's tasks are the plan; do not keep it anywhere else.

1. Definition of done: what does "achieved" look like, concretely?
2. Milestones: 2-5 ordered checkpoints, each a candidate sub-goal.
3. Dependencies and blockers: what must happen first, and who is on the critical path?
4. First actions: the 1-3 tasks that can start today.
5. Open questions for the human: deadlines, budget, scope trade-offs. Ask before capturing.

Check recall for memories about this goal before asking the human things they may already have answered.`;
}
