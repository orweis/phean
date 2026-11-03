import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export const TEST_ORIGIN = "http://phean.test";
export const MCP_URL = `${TEST_ORIGIN}/mcp`;

type Handler = (request: Request) => Promise<Response>;

/** Routes the client's HTTP traffic straight into the route handler, with no server or sockets. */
export function inProcessFetch(handler: Handler) {
  return (input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init));
}

export async function connectMcpClient(handler: Handler, token: string): Promise<Client> {
  const client = new Client({ name: "phean-test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: inProcessFetch(handler),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

interface ToolResultLike {
  isError?: boolean;
  content?: unknown;
  structuredContent?: unknown;
}

export function textOf(result: ToolResultLike): string {
  const content = (result.content ?? []) as { type: string; text?: string }[];
  return content.map((block) => block.text ?? "").join("\n");
}

/** Structured output of a successful tool call; fails loudly with the tool's message otherwise. */
export function dataOf<T = Record<string, unknown>>(result: ToolResultLike): T {
  if (result.isError) throw new Error(`tool returned an error: ${textOf(result)}`);
  return result.structuredContent as T;
}
