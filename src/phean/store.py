"""SQLite persistence layer for Phean: schema, CRUD, FTS5 search, summaries."""

from __future__ import annotations

import os
import secrets
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .models import (
    OPEN_TASK_STATUSES,
    GoalStatus,
    Priority,
    Source,
    TaskStatus,
    goal_status_values,
    priority_values,
    source_values,
    task_status_values,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS goals (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'proposed',
    approved    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'inbox',
    priority     TEXT NOT NULL DEFAULT 'medium',
    source       TEXT NOT NULL DEFAULT 'manual',
    source_ref   TEXT NOT NULL DEFAULT '',
    due_date     TEXT,
    goal_id      TEXT REFERENCES goals(id) ON DELETE SET NULL,
    tags         TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    completed_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
    title, description, tags, content='tasks', content_rowid='rowid'
);
CREATE VIRTUAL TABLE IF NOT EXISTS goals_fts USING fts5(
    title, description, content='goals', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(rowid, title, description, tags)
    VALUES (new.rowid, new.title, new.description, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, description, tags)
    VALUES ('delete', old.rowid, old.title, old.description, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
    INSERT INTO tasks_fts(tasks_fts, rowid, title, description, tags)
    VALUES ('delete', old.rowid, old.title, old.description, old.tags);
    INSERT INTO tasks_fts(rowid, title, description, tags)
    VALUES (new.rowid, new.title, new.description, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS goals_ai AFTER INSERT ON goals BEGIN
    INSERT INTO goals_fts(rowid, title, description)
    VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER IF NOT EXISTS goals_ad AFTER DELETE ON goals BEGIN
    INSERT INTO goals_fts(goals_fts, rowid, title, description)
    VALUES ('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER IF NOT EXISTS goals_au AFTER UPDATE ON goals BEGIN
    INSERT INTO goals_fts(goals_fts, rowid, title, description)
    VALUES ('delete', old.rowid, old.title, old.description);
    INSERT INTO goals_fts(rowid, title, description)
    VALUES (new.rowid, new.title, new.description);
END;
"""

_TASK_FIELDS = {
    "title",
    "description",
    "status",
    "priority",
    "source",
    "source_ref",
    "due_date",
    "goal_id",
    "tags",
}
_GOAL_FIELDS = {"title", "description", "status", "approved"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(4)}"


def _fts_query(query: str) -> str:
    """Quote each term (so arbitrary input never breaks FTS5 syntax) and add
    prefix matching so 'audit' also finds 'auditor'."""
    terms = [t.replace('"', '""') for t in query.split() if t]
    return " ".join(f'"{t}"*' for t in terms)


def default_db_path() -> Path:
    env = os.environ.get("PHEAN_DB")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".phean" / "phean.db"


class StoreError(ValueError):
    """Raised for invalid input (unknown id, bad enum value, etc.)."""


class Store:
    def __init__(self, db_path: str | Path | None = None):
        path = str(db_path) if db_path is not None else str(default_db_path())
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # FastMCP runs sync tools in worker threads; the stdlib sqlite3 module is
        # built in serialized mode (threadsafety=3), so sharing one connection
        # across threads is safe once the affinity check is disabled.
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(_SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # ------------------------------------------------------------- helpers

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        if "approved" in d:
            d["approved"] = bool(d["approved"])
        return d

    def _validate(self, field: str, value: Any) -> None:
        allowed: list[str] | None = {
            "status_task": task_status_values(),
            "status_goal": goal_status_values(),
            "priority": priority_values(),
            "source": source_values(),
        }.get(field)
        if allowed is not None and value not in allowed:
            raise StoreError(f"invalid {field.split('_')[0]} {value!r}; allowed: {allowed}")

    # --------------------------------------------------------------- goals

    def create_goal(
        self,
        title: str,
        description: str = "",
        status: str = GoalStatus.PROPOSED.value,
        approved: bool = False,
    ) -> dict[str, Any]:
        if not title.strip():
            raise StoreError("goal title must not be empty")
        self._validate("status_goal", status)
        now = _now()
        gid = _new_id("g")
        self.conn.execute(
            "INSERT INTO goals (id, title, description, status, approved, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (gid, title.strip(), description, status, int(approved), now, now),
        )
        self.conn.commit()
        return self.get_goal(gid)

    def get_goal(self, goal_id: str) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
        if row is None:
            raise StoreError(f"no goal with id {goal_id!r}")
        return self._row_to_dict(row)

    def update_goal(self, goal_id: str, **fields: Any) -> dict[str, Any]:
        self.get_goal(goal_id)
        updates = {k: v for k, v in fields.items() if k in _GOAL_FIELDS and v is not None}
        if not updates:
            raise StoreError(f"nothing to update; settable fields: {sorted(_GOAL_FIELDS)}")
        if "status" in updates:
            self._validate("status_goal", updates["status"])
        if "approved" in updates:
            updates["approved"] = int(bool(updates["approved"]))
        updates["updated_at"] = _now()
        cols = ", ".join(f"{k} = ?" for k in updates)
        self.conn.execute(
            f"UPDATE goals SET {cols} WHERE id = ?", (*updates.values(), goal_id)
        )
        self.conn.commit()
        return self.get_goal(goal_id)

    def list_goals(self, status: str | None = None) -> list[dict[str, Any]]:
        if status is not None:
            self._validate("status_goal", status)
            rows = self.conn.execute(
                "SELECT * FROM goals WHERE status = ? ORDER BY created_at", (status,)
            ).fetchall()
        else:
            rows = self.conn.execute("SELECT * FROM goals ORDER BY created_at").fetchall()
        goals = [self._row_to_dict(r) for r in rows]
        for goal in goals:
            counts = self.conn.execute(
                "SELECT status, COUNT(*) AS n FROM tasks WHERE goal_id = ? GROUP BY status",
                (goal["id"],),
            ).fetchall()
            by_status = {r["status"]: r["n"] for r in counts}
            goal["open_tasks"] = sum(by_status.get(s, 0) for s in OPEN_TASK_STATUSES)
            goal["done_tasks"] = by_status.get(TaskStatus.DONE.value, 0)
        return goals

    # --------------------------------------------------------------- tasks

    def create_task(
        self,
        title: str,
        description: str = "",
        status: str = TaskStatus.INBOX.value,
        priority: str = Priority.MEDIUM.value,
        source: str = Source.MANUAL.value,
        source_ref: str = "",
        due_date: str | None = None,
        goal_id: str | None = None,
        tags: str = "",
    ) -> dict[str, Any]:
        if not title.strip():
            raise StoreError("task title must not be empty")
        self._validate("status_task", status)
        self._validate("priority", priority)
        self._validate("source", source)
        if goal_id is not None:
            self.get_goal(goal_id)
        now = _now()
        tid = _new_id("t")
        self.conn.execute(
            "INSERT INTO tasks (id, title, description, status, priority, source, source_ref,"
            " due_date, goal_id, tags, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                tid,
                title.strip(),
                description,
                status,
                priority,
                source,
                source_ref,
                due_date,
                goal_id,
                tags,
                now,
                now,
            ),
        )
        self.conn.commit()
        return self.get_task(tid)

    def get_task(self, task_id: str) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise StoreError(f"no task with id {task_id!r}")
        return self._row_to_dict(row)

    def update_task(self, task_id: str, **fields: Any) -> dict[str, Any]:
        current = self.get_task(task_id)
        updates = {k: v for k, v in fields.items() if k in _TASK_FIELDS and v is not None}
        if not updates:
            raise StoreError(f"nothing to update; settable fields: {sorted(_TASK_FIELDS)}")
        if "status" in updates:
            self._validate("status_task", updates["status"])
        if "priority" in updates:
            self._validate("priority", updates["priority"])
        if "source" in updates:
            self._validate("source", updates["source"])
        if "goal_id" in updates:
            self.get_goal(updates["goal_id"])
        updates["updated_at"] = _now()
        if updates.get("status") == TaskStatus.DONE.value and not current["completed_at"]:
            updates["completed_at"] = _now()
        cols = ", ".join(f"{k} = ?" for k in updates)
        self.conn.execute(
            f"UPDATE tasks SET {cols} WHERE id = ?", (*updates.values(), task_id)
        )
        self.conn.commit()
        return self.get_task(task_id)

    def complete_task(self, task_id: str, note: str = "") -> dict[str, Any]:
        task = self.get_task(task_id)
        description = task["description"]
        if note:
            description = f"{description}\n\n[completion note] {note}".strip()
        return self.update_task(
            task_id, status=TaskStatus.DONE.value, description=description
        )

    def assign_tasks_to_goal(self, task_ids: list[str], goal_id: str) -> list[dict[str, Any]]:
        self.get_goal(goal_id)
        results = []
        for tid in task_ids:
            task = self.get_task(tid)
            fields: dict[str, Any] = {"goal_id": goal_id}
            # Triage semantics: assigning an inbox task promotes it to todo.
            if task["status"] == TaskStatus.INBOX.value:
                fields["status"] = TaskStatus.TODO.value
            results.append(self.update_task(tid, **fields))
        return results

    def list_tasks(
        self,
        status: str | None = None,
        goal_id: str | None = None,
        priority: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        clauses, params = [], []
        if status is not None:
            self._validate("status_task", status)
            clauses.append("status = ?")
            params.append(status)
        if goal_id is not None:
            clauses.append("goal_id = ?")
            params.append(goal_id)
        if priority is not None:
            self._validate("priority", priority)
            clauses.append("priority = ?")
            params.append(priority)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.conn.execute(
            f"SELECT * FROM tasks {where} ORDER BY created_at LIMIT ?", (*params, limit)
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    # -------------------------------------------------------------- search

    def search(
        self,
        query: str,
        kind: str | None = None,
        status: str | None = None,
        goal_id: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        if kind not in (None, "task", "goal"):
            raise StoreError("kind must be 'task', 'goal', or omitted")
        fts = _fts_query(query)
        if not fts:
            raise StoreError("query must not be empty")
        results: list[dict[str, Any]] = []
        if kind in (None, "task"):
            clauses, params = ["tasks_fts MATCH ?"], [fts]
            if status is not None:
                self._validate("status_task", status)
                clauses.append("t.status = ?")
                params.append(status)
            if goal_id is not None:
                clauses.append("t.goal_id = ?")
                params.append(goal_id)
            rows = self.conn.execute(
                "SELECT t.*, rank FROM tasks_fts JOIN tasks t ON t.rowid = tasks_fts.rowid"
                f" WHERE {' AND '.join(clauses)} ORDER BY rank LIMIT ?",
                (*params, limit),
            ).fetchall()
            for r in rows:
                d = self._row_to_dict(r)
                d["kind"] = "task"
                results.append(d)
        if kind in (None, "goal") and status is None and goal_id is None:
            rows = self.conn.execute(
                "SELECT g.*, rank FROM goals_fts JOIN goals g ON g.rowid = goals_fts.rowid"
                " WHERE goals_fts MATCH ? ORDER BY rank LIMIT ?",
                (fts, limit),
            ).fetchall()
            for r in rows:
                d = self._row_to_dict(r)
                d["kind"] = "goal"
                results.append(d)
        results.sort(key=lambda d: d.pop("rank"))
        return results[:limit]

    # ----------------------------------------------------------- summaries

    def next_actions(self, limit: int = 5) -> list[dict[str, Any]]:
        placeholders = ", ".join("?" for _ in OPEN_TASK_STATUSES)
        rows = self.conn.execute(
            f"SELECT * FROM tasks WHERE status IN ({placeholders}) ORDER BY"
            " CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1"
            " WHEN 'medium' THEN 2 ELSE 3 END,"
            " due_date IS NULL, due_date, created_at LIMIT ?",
            (*OPEN_TASK_STATUSES, limit),
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def status_summary(self) -> dict[str, Any]:
        task_counts = {
            r["status"]: r["n"]
            for r in self.conn.execute(
                "SELECT status, COUNT(*) AS n FROM tasks GROUP BY status"
            ).fetchall()
        }
        goal_counts = {
            r["status"]: r["n"]
            for r in self.conn.execute(
                "SELECT status, COUNT(*) AS n FROM goals GROUP BY status"
            ).fetchall()
        }
        today = date.today().isoformat()
        placeholders = ", ".join("?" for _ in OPEN_TASK_STATUSES)
        overdue = [
            self._row_to_dict(r)
            for r in self.conn.execute(
                f"SELECT * FROM tasks WHERE status IN ({placeholders})"
                " AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date",
                (*OPEN_TASK_STATUSES, today),
            ).fetchall()
        ]
        return {
            "tasks_by_status": task_counts,
            "goals_by_status": goal_counts,
            "inbox_size": task_counts.get(TaskStatus.INBOX.value, 0),
            "open_tasks": sum(task_counts.get(s, 0) for s in OPEN_TASK_STATUSES),
            "overdue": overdue,
        }
