import pytest

from phean.server import build_server
from phean.store import Store
from phean.tools.visualize import build_goal_tree, build_kanban, build_timeline


@pytest.fixture
def store():
    s = Store(":memory:")
    yield s
    s.close()


def test_build_server_registers_everything(store):
    mcp = build_server(store)

    import asyncio

    tools = {t.name for t in asyncio.run(mcp.list_tools())}
    expected = {
        "create_goal",
        "update_goal",
        "list_goals",
        "capture_tasks",
        "update_task",
        "complete_task",
        "assign_tasks_to_goal",
        "list_tasks",
        "search",
        "plan_goal",
        "suggest_next_actions",
        "visualize",
        "get_status_summary",
    }
    assert expected <= tools

    prompts = {p.name for p in asyncio.run(mcp.list_prompts())}
    assert {"triage_inbox", "daily_review", "scan_sources"} <= prompts


def test_goal_tree_mermaid(store):
    goal = store.create_goal('Ship "v1" (fast)')
    store.create_task("Write [the] docs", goal_id=goal["id"])
    store.create_task("Untriaged item")

    mermaid = build_goal_tree(store.list_goals(), store.list_tasks())
    assert mermaid.startswith("flowchart TD")
    assert "Ship 'v1' (fast)" in mermaid  # double quotes sanitized
    assert "unassigned" in mermaid


def test_kanban_mermaid(store):
    t = store.create_task("Do the thing")
    store.create_task("Done thing", status="done")
    mermaid = build_kanban(store.list_tasks())
    assert mermaid.startswith("kanban")
    assert "col_inbox[Inbox]" in mermaid
    assert "Do the thing" in mermaid
    assert "Done thing" in mermaid
    assert t["id"].replace("-", "_") in mermaid


def test_timeline_mermaid(store):
    goal = store.create_goal("Audit")
    store.create_task("Redlines", goal_id=goal["id"], due_date="2026-09-03")
    store.create_task("No due date")
    mermaid = build_timeline(store.list_tasks(), store.list_goals())
    assert mermaid.startswith("gantt")
    assert "section Audit" in mermaid
    assert "Redlines :2026-09-03, 1d" in mermaid
    assert "No due date" not in mermaid


def test_timeline_empty(store):
    mermaid = build_timeline([], [])
    assert "gantt" in mermaid


def test_plan_goal_scaffold(store):
    from phean.tools.planning import _SCAFFOLD

    goal = store.create_goal("Big goal")
    scaffold = _SCAFFOLD.format(title=goal["title"], goal_id=goal["id"])
    assert "Definition of done" in scaffold
    assert goal["id"] in scaffold
