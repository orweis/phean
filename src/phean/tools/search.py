"""Full-text search across tasks and goals."""

from __future__ import annotations

from typing import Any

from ..store import Store


def register(mcp: Any, store: Store) -> None:
    @mcp.tool
    def search(
        query: str,
        kind: str | None = None,
        status: str | None = None,
        goal_id: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """Full-text search over tasks and goals (titles, descriptions, tags).
        kind: 'task' | 'goal' | omitted for both. status/goal_id filters apply to
        tasks. Results carry a 'kind' field and are relevance-ranked. Use this
        before capturing to avoid duplicates."""
        return store.search(query, kind=kind, status=status, goal_id=goal_id, limit=limit)
