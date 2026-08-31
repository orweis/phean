import pytest

from phean.store import Store, StoreError


@pytest.fixture
def store():
    s = Store(":memory:")
    yield s
    s.close()


def test_goal_crud_and_approval(store):
    goal = store.create_goal("Close Q3 audit", description="wrap the audit")
    assert goal["id"].startswith("g-")
    assert goal["status"] == "proposed"
    assert goal["approved"] is False

    updated = store.update_goal(goal["id"], status="active", approved=True)
    assert updated["status"] == "active"
    assert updated["approved"] is True

    goals = store.list_goals(status="active")
    assert [g["id"] for g in goals] == [goal["id"]]
    assert goals[0]["open_tasks"] == 0


def test_task_lifecycle(store):
    task = store.create_task("Send redlines", source="email", source_ref="thread-123")
    assert task["status"] == "inbox"
    assert task["completed_at"] is None

    store.update_task(task["id"], status="in_progress", priority="urgent")
    done = store.complete_task(task["id"], note="sent via email")
    assert done["status"] == "done"
    assert done["completed_at"] is not None
    assert "sent via email" in done["description"]


def test_assign_promotes_inbox_to_todo(store):
    goal = store.create_goal("Website relaunch")
    t1 = store.create_task("Copy review")
    t2 = store.create_task("DNS cutover", status="in_progress")
    results = store.assign_tasks_to_goal([t1["id"], t2["id"]], goal["id"])
    assert results[0]["status"] == "todo"  # inbox -> todo
    assert results[1]["status"] == "in_progress"  # untouched
    assert all(r["goal_id"] == goal["id"] for r in results)

    listed = store.list_goals()
    assert listed[0]["open_tasks"] == 2


def test_search_fts_and_filters(store):
    goal = store.create_goal("Close Q3 audit")
    store.create_task("Book auditor call", goal_id=goal["id"])
    store.create_task("Unrelated errand")

    hits = store.search("audit")
    kinds = {h["kind"] for h in hits}
    assert kinds == {"task", "goal"}

    task_hits = store.search("auditor", kind="task")
    assert len(task_hits) == 1
    assert task_hits[0]["title"] == "Book auditor call"

    # Punctuation-laden queries must not raise FTS syntax errors.
    assert store.search('audit-"call" (urgent)') is not None


def test_validation_errors(store):
    with pytest.raises(StoreError):
        store.create_task("x", status="bogus")
    with pytest.raises(StoreError):
        store.create_goal("")
    with pytest.raises(StoreError):
        store.get_task("t-nope")
    with pytest.raises(StoreError):
        store.create_task("orphan", goal_id="g-nope")


def test_next_actions_ranking(store):
    low = store.create_task("Low prio", priority="low")
    urgent = store.create_task("Urgent thing", priority="urgent")
    due_soon = store.create_task("Medium due soon", priority="medium", due_date="2020-01-01")
    store.complete_task(low["id"])

    actions = store.next_actions()
    ids = [a["id"] for a in actions]
    assert ids == [urgent["id"], due_soon["id"]]


def test_status_summary(store):
    store.create_task("Old due", due_date="2020-01-01", status="todo")
    store.create_task("Fresh inbox item")
    summary = store.status_summary()
    assert summary["inbox_size"] == 1
    assert summary["open_tasks"] == 2
    assert len(summary["overdue"]) == 1
