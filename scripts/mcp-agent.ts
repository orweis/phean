import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export type ToolArgs = Record<string, unknown>;

/** An agent connected to a Phean deployment's MCP endpoint with its bearer token. */
export async function connectAgent(baseUrl: string, token: string, name: string) {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
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
