import type { ConversationTurn, LLMPort, LLMTurnResult, ToolDefinition } from "../../domain/ports/LLMPort";

// Adapter "falso", usado apenas para testar toda a esteira
// app -> backend -> LLMPort -> ToolsPort -> servidores MCP -> services -> Postgres
// sem depender de uma chave de API real (Gemini/Claude/GPT). NÃO é um dos
// 3 provedores exigidos pelo projeto — é um utilitário extra para
// desenvolvimento/demonstração. Ative com LLM_PROVIDER=mock no .env.
//
// Protocolo simples reconhecido pelo mock: se a mensagem do usuário for
// exatamente "TOOL:<nome_da_tool>:<json_dos_argumentos>", ele chama essa
// tool de verdade (via ToolsPort, nos servidores MCP reais) e devolve o
// resultado formatado. Qualquer outra mensagem só recebe um eco de texto.
export class MockAdapter implements LLMPort {
  readonly providerName = "mock";

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    const ultimoTurno = params.turns[params.turns.length - 1];

    // Depois de receber o resultado de uma tool, apenas resume em texto.
    if (ultimoTurno?.role === "tool_results") {
      const resumo = ultimoTurno.results
        .map((r) => `Resultado de "${r.name}": ${JSON.stringify(r.result)}`)
        .join("\n");
      return { type: "text", text: `[mock] ${resumo}` };
    }

    if (ultimoTurno?.role === "user") {
      const match = ultimoTurno.content.match(/^TOOL:([a-zA-Z0-9_]+):(.*)$/s);
      if (match) {
        const [, nomeTool, argsJson] = match;
        const toolExiste = params.tools.some((t) => t.name === nomeTool);
        if (!toolExiste) {
          return { type: "text", text: `[mock] Tool "${nomeTool}" não existe nas tools disponíveis.` };
        }
        let args: Record<string, unknown> = {};
        try {
          args = argsJson.trim() ? JSON.parse(argsJson) : {};
        } catch {
          return { type: "text", text: `[mock] JSON de argumentos inválido: ${argsJson}` };
        }
        return {
          type: "tool_calls",
          toolCalls: [{ id: `mock-call-${Date.now()}`, name: nomeTool, arguments: args }],
        };
      }

      return {
        type: "text",
        text: `[mock] Você disse: "${ultimoTurno.content}". Para testar uma tool real, envie "TOOL:<nome>:<json>", ex: TOOL:listar_cursos:{}`,
      };
    }

    return { type: "text", text: "[mock] (nada a responder)" };
  }
}
