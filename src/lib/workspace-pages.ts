import { routes } from "./routes";

/**
 * A workspace's pages, in tab order: the tab rail draws them, and search offers them as places to
 * go. `words` are what else a person might type for the page ("kanban" finds Tasks).
 */
export const WORKSPACE_PAGES = [
  { key: "overview", label: "Overview", href: routes.workspace, exact: true, words: ["home", "dashboard", "status"] },
  { key: "decisions", label: "Decisions", href: routes.decisions, words: ["questions", "answers", "approvals"] },
  { key: "tasks", label: "Tasks", href: routes.board, words: ["board", "kanban", "table", "calendar", "map", "lanes"] },
  { key: "goals", label: "Goals", href: routes.goals, words: ["outcomes", "progress", "objectives"] },
  { key: "timeline", label: "Timeline", href: routes.timeline, words: ["timetable", "gantt", "history", "flow"] },
  { key: "memory", label: "Memory", href: routes.memory, words: ["facts", "notes", "preferences", "choices"] },
  { key: "documents", label: "Documents", href: routes.documents, words: ["files", "drafts", "docs"] },
  { key: "search", label: "Search", href: routes.search, words: ["find"] },
  { key: "agents", label: "Agents", href: routes.agents, words: ["bots", "keys", "connect", "mcp", "webhooks"] },
  { key: "members", label: "Members", href: routes.members, words: ["people", "team", "invite"] },
] as const;

export type WorkspacePageKey = (typeof WORKSPACE_PAGES)[number]["key"];
