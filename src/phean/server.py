"""Phean MCP server entrypoint."""

from __future__ import annotations

from fastmcp import FastMCP

from .guidance import INSTRUCTIONS
from .guidance import prompts as guidance_prompts
from .store import Store
from .tools import goals, planning, search, tasks, visualize


def build_server(store: Store | None = None) -> FastMCP:
    store = store or Store()
    mcp = FastMCP(name="Phean", instructions=INSTRUCTIONS)
    for module in (goals, tasks, search, planning, visualize):
        module.register(mcp, store)
    guidance_prompts.register(mcp)
    return mcp


def main() -> None:
    build_server().run()


if __name__ == "__main__":
    main()
