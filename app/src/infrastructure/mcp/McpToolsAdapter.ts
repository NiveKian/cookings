import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolsPort } from "../../domain/ports/ToolsPort";
import type { ToolDefinition } from "../../domain/ports/LLMPort";

// Adapter que implementa ToolsPort conectando-se aos 3 servidores MCP
// (mcp_cursos, mcp_matriculas, mcp_receitas) via streamable-http.
// Roda apenas no backend (server.ts) — nunca no navegador.

interface McpServerConfig {
  name: string;
  url: string;
}

export class McpToolsAdapter implements ToolsPort {
  private clients = new Map<string, Client>();
  // Mapa tool -> nome do servidor MCP dono dela, preenchido em listTools().
  private toolOwner = new Map<string, string>();
  private connected = false;

  constructor(private readonly servers: McpServerConfig[]) {}

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;

    for (const server of this.servers) {
      const client = new Client({ name: "cookings-app", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(server.url));
      await client.connect(transport);
      this.clients.set(server.name, client);
    }

    this.connected = true;
  }

  async listTools(): Promise<ToolDefinition[]> {
    await this.ensureConnected();

    const todas: ToolDefinition[] = [];
    for (const [serverName, client] of this.clients) {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        this.toolOwner.set(tool.name, serverName);
        todas.push({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
        });
      }
    }
    return todas;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();

    // Garante que toolOwner está populado mesmo se callTool for chamado
    // antes de listTools() nesta instância.
    if (this.toolOwner.size === 0) {
      await this.listTools();
    }

    const serverName = this.toolOwner.get(name);
    if (!serverName) {
      throw new Error(`Tool "${name}" não encontrada em nenhum servidor MCP conectado.`);
    }

    const client = this.clients.get(serverName)!;
    const resultado = await client.callTool({ name, arguments: args });

    // O conteúdo de retorno de uma tool MCP vem como uma LISTA de blocos.
    // Tools que retornam um único objeto (ex: obter_curso) normalmente
    // produzem 1 bloco; tools que retornam uma lista (ex: listar_cursos)
    // produzem 1 bloco de texto POR ITEM da lista — por isso cada bloco é
    // parseado individualmente, nunca concatenado antes do JSON.parse.
    const blocos = resultado.content as Array<{ type: string; text?: string }>;
    const textos = blocos.filter((b) => b.type === "text" && b.text).map((b) => b.text!);

    if (textos.length === 0) return null;

    const itens = textos.map((t) => {
      try {
        return JSON.parse(t);
      } catch {
        return t;
      }
    });

    return itens.length === 1 ? itens[0] : itens;
  }
}
