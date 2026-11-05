import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export type ToolArgs = Record<string, unknown>;

/** Connects to Phean's MCP endpoint; with `agentName`, as a sub-agent sharing the token's key under that name. */
export async function connectAgent(baseUrl: string, token: string, name: string, agentName?: string) {
  const client = new Client({ name, version: "1.0.0" });
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(agentName && { "Phean-Agent-Name": agentName }) };
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), { requestInit: { headers } }));
  /** Calls a tool and returns its structured result, throwing on a tool error. */
  const call = async <T = ToolArgs>(tool: string, args: ToolArgs = {}): Promise<T> => {
    const result = await client.callTool({ name: tool, arguments: args });
    if (result.isError) {
      const text = (result.content as { text?: string }[]).map((block) => block.text ?? "").join("\n");
      throw new Error(`${name} → ${tool} failed: ${text}`);
    }
    return result.structuredContent as T;
  };
  return { client, call };
}

export type ConnectedAgent = Awaited<ReturnType<typeof connectAgent>>;
