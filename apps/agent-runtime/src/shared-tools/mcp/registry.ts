import { z } from "zod";

/**
 * MCP-compatible tool registry.
 *
 * Tools are described with a name, JSON-Schema-able Zod input, and a handler.
 * This mirrors the Model Context Protocol tool shape so the same registry can be
 * exposed over MCP transport (see client.ts) or invoked directly in-process.
 *
 * Registering a tool here does NOT grant it runtime authority — write/approval
 * gating is enforced by the tool implementations and the guardrails, not here.
 */
export interface McpTool<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  name: string;
  description: string;
  inputSchema: I;
  /** Whether invoking this tool can have customer-facing or write side effects. */
  sideEffecting: boolean;
  handler: (input: z.infer<I>) => Promise<O> | O;
}

export class McpToolRegistry {
  private readonly tools = new Map<string, McpTool>();

  register<I extends z.ZodTypeAny, O>(tool: McpTool<I, O>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`MCP tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as McpTool);
    return this;
  }

  list(): { name: string; description: string; sideEffecting: boolean }[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      sideEffecting: t.sideEffecting,
    }));
  }

  get(name: string): McpTool | undefined {
    return this.tools.get(name);
  }

  async invoke(name: string, rawInput: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
    const input = tool.inputSchema.parse(rawInput);
    return tool.handler(input);
  }
}

/** Process-wide registry instance. */
export const mcpRegistry = new McpToolRegistry();
