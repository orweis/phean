/**
 * Where a person picks a task back up with the agent working on it: the agent's session (a link
 * to the conversation or message, its ids, a command that resumes it) and the question it is
 * waiting on. Stored as JSON on the task; client-safe.
 */

/**
 * Schemes a resume link may use: the web, and the desktop apps agents run in. Links are agent
 * input rendered for people to click, so any other scheme (javascript:, data:, file:) is refused.
 */
export const RESUME_URL_SCHEMES = ["https", "http", "cursor", "vscode", "vscode-insiders", "windsurf", "zed", "claude", "slack", "msteams"] as const;

/** Sessions kept per task, newest first: one per agent. */
export const MAX_SESSIONS = 8;

export interface AgentSession {
  agentId: string;
  agentName: string;
  /** Where the session lives: "Claude Code", "Cursor", "Slack". */
  app: string | null;
  /** Opens the conversation or message: the one-click way back. */
  url: string | null;
  sessionId: string | null;
  messageId: string | null;
  /** A shell command that resumes the session, for clients without links. */
  command: string | null;
  /** Where things stand, in the agent's words. */
  brief: string;
  /** ISO timestamp of the last time the agent linked it. */
  linkedAt: string;
}

/** A question an agent needs a person to answer before it can go on. */
export interface InputRequest {
  question: string;
  agentId: string;
  agentName: string;
  /** ISO timestamp. */
  askedAt: string;
}

function schemeOf(value: string): string | null {
  try {
    return new URL(value).protocol.slice(0, -1);
  } catch {
    return null;
  }
}

export function isResumeUrl(value: string): boolean {
  const scheme = schemeOf(value);
  return scheme !== null && (RESUME_URL_SCHEMES as readonly string[]).includes(scheme);
}

/** An http(s) link, safe to render as one and opened in a new tab; app links open their app instead. */
export function isWebUrl(value: string): boolean {
  const scheme = schemeOf(value);
  return scheme === "https" || scheme === "http";
}

/** The agent's new session first, replacing its previous one, so each agent has one place to resume. */
export function withSession(sessions: readonly AgentSession[], next: AgentSession): AgentSession[] {
  return [next, ...sessions.filter((session) => session.agentId !== next.agentId)].slice(0, MAX_SESSIONS);
}

/** Whether linking `next` points somewhere new, rather than refreshing the brief or the message. */
export function movesSession(previous: AgentSession | undefined, next: AgentSession): boolean {
  return !previous || previous.url !== next.url || previous.sessionId !== next.sessionId || previous.command !== next.command;
}

export function resumeLabel(session: Pick<AgentSession, "app">): string {
  return session.app ? `Resume in ${session.app}` : "Resume conversation";
}

/** The session of the agent that asked, which is where its question is best answered. */
export function sessionOfAsker(sessions: readonly AgentSession[], request: InputRequest): AgentSession | undefined {
  return sessions.find((session) => session.agentId === request.agentId);
}
