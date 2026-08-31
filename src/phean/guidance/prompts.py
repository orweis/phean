"""MCP prompts encoding the Phean workflows."""

from __future__ import annotations

from typing import Any


def register(mcp: Any) -> None:
    @mcp.prompt
    def triage_inbox() -> str:
        """Walk the inbox: propose groupings, get approval, apply."""
        return (
            "Triage the Phean inbox:\n"
            "1. Call list_tasks(status='inbox'). If empty, say so and stop.\n"
            "2. Call list_goals() and group the inbox items under existing goals"
            " where they fit. For items that fit no goal, propose new goals"
            " (these will start as 'proposed').\n"
            "3. Present ONE batch proposal: groupings, suggested priorities and"
            " due dates, and any items that look like noise to drop. Ask for"
            " approval in a single question.\n"
            "4. On approval: create any new goals with create_goal, apply"
            " assign_tasks_to_goal and update_task, and update_goal to activate"
            " newly approved goals. Drop only items explicitly confirmed.\n"
            "5. Close with a one-line result summary and the new inbox size."
        )

    @mcp.prompt
    def daily_review() -> str:
        """Morning sweep: status, dues, next actions, inbox-rot check."""
        return (
            "Run a Phean daily review:\n"
            "1. Call get_status_summary. Lead with overdue items, if any.\n"
            "2. Call visualize(kind='kanban') and show the board in a mermaid"
            " code block with a 2-3 sentence read.\n"
            "3. Call suggest_next_actions and list the top items, marking which"
            " you can do yourself versus which need the human.\n"
            "4. If the inbox has more than 10 items or anything older than a"
            " week, flag it and offer to triage.\n"
            "5. End with one recommended action for right now."
        )

    @mcp.prompt
    def scan_sources() -> str:
        """Sweep your connectors for actionable items and capture them."""
        return (
            "Sweep your available sources for actionable items and feed Phean:\n"
            "1. Check every connector you have access to - email, Slack,"
            " calendar, and anything else. Look for requests, commitments,"
            " deadlines, follow-ups, and meetings needing prep.\n"
            "2. For each candidate, call search first to skip items Phean"
            " already tracks.\n"
            "3. Capture the rest in ONE capture_tasks call. Always set source"
            " and source_ref (link, subject, or event title), and due_date when"
            " one is evident. Do not triage yet - capture is lossless and fast.\n"
            "4. Report what you scanned and what you captured, flag anything"
            " urgent, and offer to triage the inbox next."
        )
