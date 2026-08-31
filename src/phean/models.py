"""Enums and constants for Phean's data model."""

from __future__ import annotations

from enum import Enum


class TaskStatus(str, Enum):
    INBOX = "inbox"
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    DROPPED = "dropped"


class GoalStatus(str, Enum):
    PROPOSED = "proposed"
    ACTIVE = "active"
    ACHIEVED = "achieved"
    ABANDONED = "abandoned"


class Priority(str, Enum):
    URGENT = "urgent"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Source(str, Enum):
    EMAIL = "email"
    SLACK = "slack"
    CALENDAR = "calendar"
    CHAT = "chat"
    MANUAL = "manual"
    OTHER = "other"


# Ranking order used by suggest_next_actions (lower = more important).
PRIORITY_RANK = {
    Priority.URGENT.value: 0,
    Priority.HIGH.value: 1,
    Priority.MEDIUM.value: 2,
    Priority.LOW.value: 3,
}

OPEN_TASK_STATUSES = (TaskStatus.INBOX.value, TaskStatus.TODO.value, TaskStatus.IN_PROGRESS.value)


def task_status_values() -> list[str]:
    return [s.value for s in TaskStatus]


def goal_status_values() -> list[str]:
    return [s.value for s in GoalStatus]


def priority_values() -> list[str]:
    return [p.value for p in Priority]


def source_values() -> list[str]:
    return [s.value for s in Source]
