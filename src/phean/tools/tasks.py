"""Task intake and lifecycle tools."""

from __future__ import annotations

from typing import Any

from ..store import Store


def register(mcp: Any, store: Store) -> None:
    @mcp.tool
    def capture_tasks(tasks: list[dict]) -> list[dict]:
        """Bulk-capture tasks (preferred intake path, e.g. after a source sweep).
        Each item: {title (required), description?, source? (email|slack|calendar|
        chat|manual|other), source_ref? (link/subject/event so the human can trace
        the origin), due_date? (YYYY-MM-DD), priority? (urgent|high|medium|low),
        goal_id?, tags? (comma-separated), status?}. New tasks default to status
        'inbox' awaiting triage; pass status='todo' with a goal_id when capturing
        already-planned subtasks."""
        return [store.create_task(**item) for item in tasks]

    @mcp.tool
    def update_task(
        task_id: str,
        title: str | None = None,
        description: str | None = None,
        status: str | None = None,
        priority: str | None = None,
        source: str | None = None,
        source_ref: str | None = None,
        due_date: str | None = None,
        goal_id: str | None = None,
        tags: str | None = None,
    ) -> dict:
        """Update task fields, including moving status (inbox | todo | in_progress |
        done | dropped). Only drop tasks the human has confirmed as noise."""
        return store.update_task(
            task_id,
            title=title,
            description=description,
            status=status,
            priority=priority,
            source=source,
            source_ref=source_ref,
            due_date=due_date,
            goal_id=goal_id,
            tags=tags,
        )

    @mcp.tool
    def complete_task(task_id: str, note: str = "") -> dict:
        """Mark a task done (sets completed_at). Include a short note describing
        what was actually done, especially when the agent did the work itself."""
        return store.complete_task(task_id, note=note)

    @mcp.tool
    def assign_tasks_to_goal(task_ids: list[str], goal_id: str) -> list[dict]:
        """Batch-assign tasks to a goal (the core triage move). Inbox tasks are
        automatically promoted to 'todo'."""
        return store.assign_tasks_to_goal(task_ids, goal_id)

    @mcp.tool
    def list_tasks(
        status: str | None = None,
        goal_id: str | None = None,
        priority: str | None = None,
        limit: int = 200,
    ) -> list[dict]:
        """List tasks with optional filters. Use status='inbox' to see what awaits
        triage."""
        return store.list_tasks(status=status, goal_id=goal_id, priority=priority, limit=limit)
