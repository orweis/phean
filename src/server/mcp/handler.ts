import type { AuthInfo, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";

import { AGENT_TOKEN_PREFIX, type AgentAccessLevel } from "@/lib/domain";
import { routes } from "@/lib/routes";

import packageJson from "../../../package.json" with { type: "json" };
import { verifyOAuthToken as verifyDeploymentToken, type OAuthTokenVerifier } from "../auth/oauth";
import { appUrl, mcpResourceTarget, mcpResourceUrl } from "../config";
import type { Db } from "../db/client";
import { agentRole } from "../domain/context";
import { AGENT_NAME_HEADER, agentContext, authenticateAgentToken, resolveNamedSubagent, resolveOAuthAgent, type AgentPrincipal } from "../domain/agents";
import { forbidden } from "../domain/errors";
import { PROMPTS, SERVER_INSTRUCTIONS } from "./guidance";
import { toolAllowed, toolError, type PheanTool, type ToolContext } from "./tool";
import { TOOLS } from "./tools";

export interface PheanMcpDeps {
  getDb: () => Db;
  /** Defaults to this deployment's provider. */
  verifyOAuthToken?: OAuthTokenVerifier;
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
  return { ...agentContext(db, extra.principal), url: (path) => new URL(path, extra.origin).toString(), accessEndsAt: extra.principal.accessExpiresAt };
}

function registerTool(server: McpServer, tool: PheanTool, getDb: () => Db): void {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
    async (input: unknown, call: ToolCallContext) => {
      const ctx = toolContext(getDb(), call);
      if (!ctx) return toolError(new Error("MCP request reached a tool without verified agent credentials"));
      // The list already leaves it out; this holds if a level's handler is ever reached with another's principal.
      if (!toolAllowed(tool, ctx.actor)) return toolError(forbidden("Your access level does not allow this tool. Ask a person to reconnect you with more access."));
      return tool.execute(ctx, input);
    },
  );
}

/** Registers what an agent of this level may use: `tools/list` shows exactly these. */
export function registerPheanServer(server: McpServer, { getDb }: PheanMcpDeps, level: AgentAccessLevel): void {
  const actor = { type: "agent", id: "", name: "", role: agentRole(level) } as const;
  for (const tool of TOOLS) if (toolAllowed(tool, actor)) registerTool(server, tool, getDb);
  for (const prompt of PROMPTS) {
    server.registerPrompt(prompt.name, { title: prompt.title, description: prompt.description }, () => ({
      description: prompt.description,
      messages: [{ role: "user", content: { type: "text", text: prompt.text } }],
    }));
  }
}

/**
 * The remote MCP endpoint. Every request must carry `Authorization: Bearer`, with a `phn_` key or
 * an OAuth access token; the token alone decides the workspace and the acting agent, never the tool input.
 */
export function createPheanMcpHandler(deps: PheanMcpDeps): (request: Request) => Promise<Response> {
  const { getDb, verifyOAuthToken = verifyDeploymentToken } = deps;
  // mcp-handler fixes the tool list when it builds a handler, so each level gets its own, made on first use.
  const handlers = new Map<AgentAccessLevel, (request: Request) => Promise<Response>>();
  const handlerFor = (level: AgentAccessLevel) => {
    let handler = handlers.get(level);
    if (!handler) {
      handler = createMcpHandler((server) => registerPheanServer(server, deps, level), {
        serverInfo: { name: "phean", version: packageJson.version },
        instructions: SERVER_INSTRUCTIONS,
      });
      handlers.set(level, handler);
    }
    return handler;
  };
  const handler = (request: Request & { auth?: AuthInfo }) => {
    const principal = (request.auth?.extra as PheanAuthExtra | undefined)?.principal;
    if (!principal) return Promise.resolve(new Response("Unauthorized", { status: 401 }));
    return handlerFor(principal.agent.level)(request);
  };

  /** The workspace the endpoint's address names, if any; a credential for any other is refused there. */
  const authenticate = async (bearerToken: string, slug: string | null): Promise<AgentPrincipal | null> => {
    let principal: AgentPrincipal | null;
    if (bearerToken.startsWith(AGENT_TOKEN_PREFIX)) principal = await authenticateAgentToken(getDb(), bearerToken);
    else {
      const verified = await verifyOAuthToken(bearerToken, mcpResourceUrl(slug ?? undefined));
      principal = verified && (await resolveOAuthAgent(getDb(), verified.agentId));
    }
    return principal && (slug === null || principal.tenant.slug === slug) ? principal : null;
  };

  const verifierFor = (slug: string | null) => async (request: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
    if (!bearerToken) return undefined;
    const token = await authenticate(bearerToken, slug);
    if (!token) return undefined;
    // A worker sharing its agent's key names itself, by header or (for clients that only take a URL) `?agent=`.
    const named = request.headers.get(AGENT_NAME_HEADER) ?? new URL(request.url).searchParams.get("agent");
    const principal = named ? await resolveNamedSubagent(deps.getDb(), token, named) : token;
    if (!principal) return undefined;
    const extra: PheanAuthExtra = { principal, origin: getPublicOrigin(request) };
    return { token: bearerToken, clientId: principal.agent.id, scopes: [], extra: { ...extra } };
  };

  return (request: Request) => {
    // The path names the endpoint; the configured address, not the request's host, makes it a resource.
    const target = mcpResourceTarget(`${appUrl()}${new URL(request.url).pathname}`);
    if (!target) return Promise.resolve(new Response("Not found", { status: 404 }));
    // resourceUrl keeps the challenge on the real address, whatever X-Forwarded-Host says.
    return withMcpAuth(handler, verifierFor(target.slug), {
      required: true,
      resourceMetadataPath: `/.well-known/oauth-protected-resource${routes.mcp(target.slug ?? undefined)}`,
      resourceUrl: appUrl(),
    })(request);
  };
}
