"""Guidance for connected agents: server instructions and MCP prompts."""

from pathlib import Path

INSTRUCTIONS = (Path(__file__).parent / "instructions.md").read_text(encoding="utf-8")
