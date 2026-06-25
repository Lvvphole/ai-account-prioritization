import { mcpRegistry, type McpToolRegistry } from "./registry";

/**
 * MCP client facade.
 *
 * In-process implementation that talks to the local registry. The interface is
 * deliberately transport-agnostic so it can be backed by a real MCP server
 * (stdio/http) without changing callers.
 */
export interface McpClient {
  listTools(): { name: string; description: string; sideEffecting: boolean }[];
  call(name: string, input: unknown): Promise<unknown>;
}

export function createInProcessMcpClient(registry: McpToolRegistry = mcpRegistry): McpClient {
  return {
    listTools: () => registry.list(),
    call: (name, input) => registry.invoke(name, input),
  };
}
