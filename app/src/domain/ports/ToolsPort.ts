import type { ToolDefinition } from "./LLMPort";

// Porta (interface) para descoberta e execução de tools — na prática,
// as tools expostas pelos 3 servidores MCP (mcp_cursos, mcp_matriculas,
// mcp_receitas). Implementada por infrastructure/mcp/McpToolsAdapter.ts.
export interface ToolsPort {
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}
