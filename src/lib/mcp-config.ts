export interface McpClientSetup {
  id: string;
  label: string;
  /** Where the snippet goes. */
  where: string;
  code: string;
}

/**
 * Copy-paste setup for common MCP clients. The server is named after the workspace so one
 * client can hold several Phean workspaces side by side.
 */
export function mcpClientSetups({ url, token, workspace }: { url: string; token: string; workspace: string }): McpClientSetup[] {
  const name = `phean-${workspace}`;
  const authorization = `Bearer ${token}`;
  const json = (value: unknown) => JSON.stringify(value, null, 2);

  return [
    {
      id: "cursor",
      label: "Cursor",
      where: "~/.cursor/mcp.json (or .cursor/mcp.json in a project)",
      code: json({ mcpServers: { [name]: { url, headers: { Authorization: authorization } } } }),
    },
    {
      id: "claude-code",
      label: "Claude Code",
      where: "Run in a terminal",
      code: `claude mcp add --transport http ${name} ${url} --header "Authorization: ${authorization}"`,
    },
    {
      id: "vscode",
      label: "VS Code",
      where: ".vscode/mcp.json",
      code: json({ servers: { [name]: { type: "http", url, headers: { Authorization: authorization } } } }),
    },
  ];
}
