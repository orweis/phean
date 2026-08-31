"""Detailed goal planning and next-action suggestion tools."""

from __future__ import annotations

from typing import Any

from ..store import Store

_SCAFFOLD = """\
## Breakdown scaffold for goal: {title}

Fill this in *with the human* in conversation, then capture the agreed subtasks
via capture_tasks (status='todo', goal_id='{goal_id}'). The tasks are the plan -
do not store this document anywhere else.

### 1. Definition of done
What does 'achieved' concretely look like? One or two sentences.

### 2. Milestones
2-5 ordered checkpoints between here and done.

### 3. Dependencies and blockers
What must happen first? Who or what is on the critical path?

### 4. First actions
The 1-3 tasks that can start today. These become the first captured subtasks.

### 5. Open questions for the human
Anything ambiguous - deadlines, budget, scope trade-offs. Ask before capturing.
"""


def register(mcp: Any, store: Store) -> None:
    @mcp.tool
    def plan_goal(goal_id: str) -> dict:
        """Start detailed planning for a goal. Returns the goal, its current tasks,
        and a breakdown scaffold (definition of done, milestones, dependencies,
        first actions, open questions). Fill the scaffold in conversation with the
        human, then capture the agreed subtasks with capture_tasks."""
        goal = store.get_goal(goal_id)
        tasks = store.list_tasks(goal_id=goal_id)
        return {
            "goal": goal,
            "existing_tasks": tasks,
            "scaffold": _SCAFFOLD.format(title=goal["title"], goal_id=goal_id),
        }

    @mcp.tool
    def suggest_next_actions(limit: int = 5) -> list[dict]:
        """Open tasks ranked by priority, then due date, then age - the answer to
        'what should I do next?'. Execute what you can with your own capabilities
        (then complete_task with a note); flag the rest as human-only."""
        return store.next_actions(limit=limit)
