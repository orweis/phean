"""Goal CRUD tools."""

from __future__ import annotations

from typing import Any

from ..store import Store


def register(mcp: Any, store: Store) -> None:
    @mcp.tool
    def create_goal(
        title: str,
        description: str = "",
        status: str = "proposed",
        approved: bool = False,
    ) -> dict:
        """Create a goal. Agent-created goals MUST stay status='proposed' and
        approved=False until the human explicitly approves them in conversation.
        Only set approved=True when relaying an explicit human decision."""
        return store.create_goal(
            title=title, description=description, status=status, approved=approved
        )

    @mcp.tool
    def update_goal(
        goal_id: str,
        title: str | None = None,
        description: str | None = None,
        status: str | None = None,
        approved: bool | None = None,
    ) -> dict:
        """Update a goal. Statuses: proposed | active | achieved | abandoned.
        Setting approved=True / status='active' is the human's sign-off - only do it
        when the human has explicitly approved the goal. Abandoning a goal also
        requires explicit human confirmation."""
        return store.update_goal(
            goal_id, title=title, description=description, status=status, approved=approved
        )

    @mcp.tool
    def list_goals(status: str | None = None) -> list[dict]:
        """List goals with open/done task counts, optionally filtered by status
        (proposed | active | achieved | abandoned)."""
        return store.list_goals(status=status)
