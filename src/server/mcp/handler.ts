import type { AuthInfo, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";

import packageJson from "../../../package.json" with { type: "json" };
import type { Db } from "../db/client";
import { AGENT_NAME_HEADER, agentContext, authenticateAgentToken, resolveNamedSubagent, type AgentPrincipal } from "../domain/agents";
import { PROMPTS, SERVER_INSTRUCTIONS } from "./guidance";
import { toolError, type PheanTool, type ToolContext } from "./tool";
import { TOOLS } from "./tools";

export interface PheanMcpDeps {
  getDb: () => Db;
}

interface PheanAuthExtra {
  principal: AgentPrincipal;
  /** Public origin the agent connected to, so links point at the same deployment. */
  origin: string;
}

type ToolCallContext = Pick<ServerContext, "http">;

function toolContext(db: Db, call: ToolCallContext): ToolContext | null {
  const extra = call.http?.authInfo?.extra as PheanAuthExtra | undefined;
  if (!extra) return null;
  return { ...agentContext(db, extra.principal), url: (path) => new URL(path, extra.origin).toString() };
}

function registerTool(server: McpServer, tool: PheanTool, getDb: () => Db): void {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
    async (input: unknown, call: ToolCallContext) => {
      const ctx = toolContext(getDb(), call);
      if (!ctx) return toolError(new Error("MCP request reached a tool without verified agent credentials"));
      return tool.execute(ctx, input);
    },
  );
}

export function registerPheanServer(server: McpServer, { getDb }: PheanMcpDeps): void {
  for (const tool of TOOLS) registerTool(server, tool, getDb);
  for (const prompt of PROMPTS) {
    server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description }, () => ({
      description: prompt.description,
      messages: [{ role: "user", content: { type: "text", text: prompt.text } }],
    }));
  }
}

/**
 * The remote MCP endpoint. Every request must carry `Authorization: Bearer phn_...`;
 * the token alone decides the workspace and the acting agent, never the tool input.
 */
export function createPheanMcpHandler(deps: PheanMcpDeps): (request: Request) => Promise<Response> {
  const handler = createMcpHandler((server) => registerPheanServer(server, deps), {
    serverInfo: { name: "phean", version: packageJson.version },
    instructions: SERVER_INSTRUCTIONS,
  });

  const verifyToken = async (request: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
    if (!bearerToken) return undefined;
    const token = await authenticateAgentToken(deps.getDb(), bearerToken);
    if (!token) return undefined;
    // A worker sharing its agent's key names itself, by header or (for clients that only take a URL) `?agent=`.
    const named = request.headers.get(AGENT_NAME_HEADER) ?? new URL(request.url).searchParams.get("agent");
    const principal = named ? await resolveNamedSubagent(deps.getDb(), token, named) : token;
    if (!principal) return undefined;
    const extra: PheanAuthExtra = { principal, origin: getPublicOrigin(request) };
    return { token: bearerToken, clientId: principal.agent.id, scopes: [], extra: { ...extra } };
  };

  return withMcpAuth(handler, verifyToken, { required: true });
}
