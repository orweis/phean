"""Mermaid visualization builders and tools.

The builders are pure functions over plain dicts so they can be unit-tested
without an MCP server. Every visualization returns Mermaid source plus a plain
text summary in case the client cannot render the diagram type.
"""

from __future__ import annotations

from typing import Any

from ..models import OPEN_TASK_STATUSES, TaskStatus
from ..store import Store

_STATUS_LABELS = {
    TaskStatus.INBOX.value: "Inbox",
    TaskStatus.TODO.value: "To Do",
    TaskStatus.IN_PROGRESS.value: "In Progress",
    TaskStatus.DONE.value: "Done",
    TaskStatus.DROPPED.value: "Dropped",
}


def _esc(label: str, max_len: int = 60) -> str:
    """Sanitize a label for use inside a quoted Mermaid node."""
    label = label.replace('"', "'").replace("\n", " ").strip()
    if len(label) > max_len:
        label = label[: max_len - 1] + "…"
    return label


def _node_id(entity_id: str) -> str:
    return entity_id.replace("-", "_")


def build_goal_tree(goals: list[dict], tasks: list[dict]) -> str:
    lines = ["flowchart TD"]
    by_goal: dict[str | None, list[dict]] = {}
    for task in tasks:
        by_goal.setdefault(task["goal_id"], []).append(task)
    for goal in goals:
        gid = _node_id(goal["id"])
        lines.append(f'    {gid}["{_esc(goal["title"])} ({goal["status"]})"]')
        for task in by_goal.get(goal["id"], []):
            tid = _node_id(task["id"])
            lines.append(f'    {tid}["{_esc(task["title"])} - {task["status"]}"]')
            lines.append(f"    {gid} --> {tid}")
    unassigned = by_goal.get(None, [])
    if unassigned:
        lines.append('    unassigned["No goal (untriaged)"]')
        for task in unassigned:
            tid = _node_id(task["id"])
            lines.append(f'    {tid}["{_esc(task["title"])} - {task["status"]}"]')
            lines.append(f"    unassigned --> {tid}")
    if len(lines) == 1:
        lines.append('    empty["Nothing tracked yet"]')
    return "\n".join(lines)


def build_kanban(tasks: list[dict]) -> str:
    lines = ["kanban"]
    columns = [
        TaskStatus.INBOX.value,
        TaskStatus.TODO.value,
        TaskStatus.IN_PROGRESS.value,
        TaskStatus.DONE.value,
    ]
    for status in columns:
        col_tasks = [t for t in tasks if t["status"] == status]
        lines.append(f"  col_{status}[{_STATUS_LABELS[status]}]")
        for task in col_tasks:
            lines.append(f'    {_node_id(task["id"])}[{_esc(task["title"], 40)}]')
    return "\n".join(lines)


def build_timeline(tasks: list[dict], goals: list[dict]) -> str:
    goal_titles = {g["id"]: g["title"] for g in goals}
    dated = sorted(
        (t for t in tasks if t["due_date"] and t["status"] != TaskStatus.DROPPED.value),
        key=lambda t: (t["goal_id"] or "", t["due_date"]),
    )
    lines = ["gantt", "    title Due dates", "    dateFormat YYYY-MM-DD"]
    if not dated:
        return "\n".join(lines + ["    section None", "    No tasks with due dates :2000-01-01, 0d"])
    current_section = object()
    for task in dated:
        section = goal_titles.get(task["goal_id"], "No goal")
        if section != current_section:
            lines.append(f"    section {_esc(section, 40)}")
            current_section = section
        done_marker = "done, " if task["status"] == TaskStatus.DONE.value else ""
        lines.append(f'    {_esc(task["title"], 40)} :{done_marker}{task["due_date"]}, 1d')
    return "\n".join(lines)


def register(mcp: Any, store: Store) -> None:
    @mcp.tool
    def visualize(kind: str, goal_id: str | None = None) -> dict:
        """Render a Mermaid view of the system. kind: 'goal_tree' (how tasks ladder
        up to goals), 'kanban' (board by status), or 'timeline' (gantt of due
        dates). Optional goal_id narrows to one goal. Returns {mermaid, summary} -
        show the mermaid block to the human in a ```mermaid fenced code block, then
        give a short prose read of it."""
        goals = store.list_goals()
        if goal_id is not None:
            goals = [g for g in goals if g["id"] == goal_id]
        tasks = store.list_tasks(goal_id=goal_id) if goal_id else store.list_tasks()
        if kind == "goal_tree":
            mermaid = build_goal_tree(goals, tasks)
        elif kind == "kanban":
            mermaid = build_kanban(tasks)
        elif kind == "timeline":
            mermaid = build_timeline(tasks, goals)
        else:
            raise ValueError("kind must be 'goal_tree', 'kanban', or 'timeline'")
        open_count = sum(1 for t in tasks if t["status"] in OPEN_TASK_STATUSES)
        done_count = sum(1 for t in tasks if t["status"] == TaskStatus.DONE.value)
        summary = (
            f"{len(goals)} goal(s), {len(tasks)} task(s): {open_count} open, {done_count} done."
        )
        return {"mermaid": mermaid, "summary": summary}

    @mcp.tool
    def get_status_summary() -> dict:
        """Counts of tasks and goals by status, inbox size, open-task total, and
        the list of overdue tasks. Start reviews here; call out inbox rot (>10
        items or anything sitting untriaged for over a week)."""
        return store.status_summary()
