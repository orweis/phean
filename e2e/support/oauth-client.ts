import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Client, StreamableHTTPClientTransport, UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/client";

type ClientMetadata = OAuthClientProvider["clientMetadata"];
type StoredClient = Awaited<ReturnType<OAuthClientProvider["clientInformation"]>>;
type StoredTokens = Awaited<ReturnType<OAuthClientProvider["tokens"]>>;

export const OAUTH_CLIENT_STATE = "e2e-state";

interface OAuthClientOptions {
  clientName?: string;
  /** Fields a client may send when it registers, such as `client_uri`. */
  metadata?: Partial<ClientMetadata>;
  /** An app's address such as `cursor://…`, which nothing here can receive. By default a loopback receiver takes the callback. */
  redirectUri?: string;
  /** The MCP endpoint the client is given: the shared one, or a workspace's own. */
  path?: string;
}

export interface ToolResult {
  isError?: boolean;
  structuredContent?: unknown;
  content?: unknown;
}

export interface OAuthTestClient {
  clientId: string;
  /** Where the client sends the person's browser. */
  authorizationUrl: string;
  /** What the browser brought back to the loopback receiver. */
  callback: () => Promise<URL>;
  /** Trades the code from the callback for tokens, then connects to the endpoint with them. */
  connect: () => Promise<{ call: (tool: string, args?: Record<string, unknown>) => Promise<ToolResult>; close: () => Promise<void> }>;
  close: () => void;
}

/** Listens on a free loopback port for the one callback, the way a command-line client does. */
async function loopbackReceiver() {
  let deliver!: (url: URL) => void;
  const received = new Promise<URL>((resolve) => (deliver = resolve));
  const server: Server = createServer((request, response) => {
    deliver(new URL(request.url ?? "/", "http://127.0.0.1"));
    response.setHeader("content-type", "text/plain");
    response.end("Connected. You can close this window.");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  return { redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`, received, close: () => void server.close() };
}

/**
 * A scripted public client that knows only the MCP URL: on its first call it gets the 401, reads
 * the metadata, registers itself and asks for authorization. A person then acts in a browser.
 */
export async function oauthClient(baseUrl: string, { clientName = "Scripted Client", metadata = {}, redirectUri, path = "/mcp" }: OAuthClientOptions = {}): Promise<OAuthTestClient> {
  const receiver = redirectUri ? null : await loopbackReceiver();
  const redirectUrl = redirectUri ?? receiver!.redirectUri;

  let information: StoredClient;
  let tokens: StoredTokens;
  let verifier = "";
  let authorizationUrl = "";
  let discovery: Awaited<ReturnType<NonNullable<OAuthClientProvider["discoveryState"]>>>;

  const authProvider: OAuthClientProvider = {
    redirectUrl,
    clientMetadata: {
      client_name: clientName,
      redirect_uris: [redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...metadata,
    },
    state: () => OAUTH_CLIENT_STATE,
    clientInformation: () => information,
    saveClientInformation: (saved) => void (information = saved),
    tokens: () => tokens,
    saveTokens: (saved) => void (tokens = saved),
    redirectToAuthorization: (url) => void (authorizationUrl = url.toString()),
    saveCodeVerifier: (saved) => void (verifier = saved),
    codeVerifier: () => verifier,
    saveDiscoveryState: (saved) => void (discovery = saved),
    discoveryState: () => discovery,
  };

  const endpoint = new URL(path, baseUrl);
  const transport = new StreamableHTTPClientTransport(endpoint, { authProvider });
  try {
    await new Client({ name: clientName, version: "1.0.0" }).connect(transport);
    throw new Error(`${path} accepted a client with no token`);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }
  if (!authorizationUrl || !information) throw new Error("the client did not reach authorization");

  return {
    clientId: information.client_id,
    authorizationUrl,
    callback: () => {
      if (!receiver) throw new Error("this client's callback goes to an app, not to a receiver");
      return receiver.received;
    },
    connect: async () => {
      const callback = await receiver!.received;
      await transport.finishAuth(callback.searchParams);
      const client = new Client({ name: clientName, version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(endpoint, { authProvider }));
      return {
        call: (tool, args = {}) => client.callTool({ name: tool, arguments: args }) as Promise<ToolResult>,
        close: () => client.close(),
      };
    },
    close: () => receiver?.close(),
  };
}
