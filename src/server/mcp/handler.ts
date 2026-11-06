import type { AuthInfo, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import { z } from "zod";

import packageJson from "../../../package.json" with { type: "json" };
import type { Db } from "../db/client";
import { AGENT_NAME_HEADER, agentContext, authenticateAgentToken, resolveNamedSubagent, type AgentPrincipal } from "../domain/agents";
import { PROMPTS, SERVER_INSTRUCTIONS } from "./guidance";
import { forbidden } from "../domain/errors";
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

/**
 * Every tool takes `actingAs`: one key shared by several bots (a hub relaying for others, an
 * orchestrator's workers) names the bot behind each call, and the call is filed under that
 * sub-agent, exactly as the `Phean-Agent-Name` header would file it. It never widens access: a
 * named sub-agent acts in its parent's workspace with an agent's permissions.
 */
export const ACTING_AS = z
  .string()
  .trim()
  .max(80)
  .optional()
  .describe(
    "The name of the bot behind this call, when one Phean key serves several (a hub relaying for other bots, an orchestrator's workers). Phean files the call under that sub-agent of yours and shows it to people by that name. Leave it out when you act as yourself.",
  );

async function toolContext(db: Db, call: ToolCallContext, actingAs: string | undefined): Promise<ToolContext | null> {
  const extra = call.http?.authInfo?.extra as PheanAuthExtra | undefined;
  if (!extra) return null;
  const principal = actingAs ? await resolveNamedSubagent(db, extra.principal, actingAs) : extra.principal;
  if (!principal) throw forbidden(`The sub-agent "${actingAs}" was revoked. Ask a workspace admin, or act under another name.`);
  return { ...agentContext(db, principal), url: (path) => new URL(path, extra.origin).toString() };
}

function registerTool(server: McpServer, tool: PheanTool, getDb: () => Db): void {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputSchema.extend({ actingAs: ACTING_AS }), annotations: tool.annotations },
    async (raw: unknown, call: ToolCallContext) => {
      const { actingAs, ...input } = raw as { actingAs?: string };
      try {
        const ctx = await toolContext(getDb(), call, actingAs || undefined);
        if (!ctx) return toolError(new Error("MCP request reached a tool without verified agent credentials"));
        return tool.execute(ctx, input);
      } catch (error) {
        return toolError(error);
      }
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
