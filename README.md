# Phean

**A Sisyphean-proof task & goal management MCP server.** You point at the hill; your agent rolls the boulder.

Phean is a task/goal management system designed to be operated by an AI agent on behalf of a human. The human defines and approves goals; the connected agent collects tasks from its own connectors (email, Slack, calendar, ...), categorizes them into goals, tracks progress, and completes tasks where it can.

Phean itself ships **no connectors**. It is the brain and the ledger:

- **Guidance** - MCP server instructions and prompts that teach the connected agent the Phean loop: *scan -> capture -> triage -> review -> execute*.
- **Tools** - CRUD and full-text search for tasks and goals, goal planning scaffolds, next-action suggestions, and Mermaid visualizations (goal tree, kanban, timeline) rendered directly in chat.

See [docs/PRD.md](docs/PRD.md), [docs/UX.md](docs/UX.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full product and design docs.

## Quickstart

Requires Python 3.10+ and [uv](https://docs.astral.sh/uv/) (recommended).

```bash
git clone https://github.com/orweis/phean.git
cd phean
uv run phean          # starts the MCP server over stdio
```

Data is stored in a single SQLite file at `~/.phean/phean.db` (override with the `PHEAN_DB` environment variable).

## Connect to an MCP client

### Cursor

Add to `~/.cursor/mcp.json` (or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "phean": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/phean", "phean"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "phean": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/phean", "phean"]
    }
  }
}
```

## The Phean loop

1. **Scan** - the agent sweeps its own connectors (email, Slack, calendar) for actionable items.
2. **Capture** - findings are bulk-captured into Phean's inbox with source metadata.
3. **Triage** - the agent proposes goal groupings and priorities; the human approves.
4. **Review** - "where do I stand?" produces Mermaid kanban / goal-tree / timeline views.
5. **Execute** - the agent surfaces next actions, completes what it can, and marks the rest.

## Tools

| Tool | Purpose |
| --- | --- |
| `create_goal` / `update_goal` / `list_goals` | Manage goals (human approves before a goal becomes active) |
| `capture_tasks` | Bulk-capture tasks into the inbox with source metadata |
| `update_task` / `complete_task` | Edit and finish tasks |
| `assign_tasks_to_goal` | Group triaged tasks under a goal |
| `search` | Full-text search (SQLite FTS5) across tasks and goals |
| `plan_goal` | Structured breakdown scaffold for detailed goal planning |
| `suggest_next_actions` | Prioritized list of what to do next |
| `visualize` | Mermaid goal tree, kanban board, or due-date timeline |
| `get_status_summary` | Counts and highlights across the whole system |

## Prompts

- `triage_inbox` - walk the inbox, propose groupings, get human approval.
- `daily_review` - morning sweep: status summary, today's dues, next actions.
- `scan_sources` - checklist for sweeping the agent's connectors for new tasks.

## Development

```bash
uv sync
uv run pytest
```

## License

MIT
