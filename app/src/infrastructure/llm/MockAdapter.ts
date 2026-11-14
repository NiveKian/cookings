import type { ConversationTurn, LLMPort, LLMTurnResult, ToolDefinition } from "../../domain/ports/LLMPort";

// Adapter "falso", usado apenas para testar toda a esteira
// app -> backend -> LLMPort -> ToolsPort -> servidores MCP -> services -> Postgres
// sem depender de uma chave de API real (Gemini/Claude/GPT). NÃO é um dos
// 3 provedores exigidos pelo projeto — é um utilitário extra para
// desenvolvimento/demonstração. Ative com LLM_PROVIDER=mock no .env.
//
// Protocolos reconhecidos na última mensagem do usuário:
// - "TOOL:<nome_da_tool>:<json_dos_argumentos>" — chama essa tool e, no
//   turno seguinte, resume o resultado em texto.
// - "CHAIN:<json array de {name, arguments}>" — emite um tool_call por
//   converse (id estável mock-chain-N). Quando a cadeia acaba, responde
//   no formato fixo de receita. Ingrediente de teste ausente: chocolate.
// Qualquer outra mensagem só recebe um eco de texto.

type PassoDaCadeia = { name: string; arguments: Record<string, unknown> };

export class MockAdapter implements LLMPort {
  readonly providerName = "mock";

  private cadeia: PassoDaCadeia[] | null = null;
  private proximoPasso = 0;
  private textoPedidos = "";

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    const ultimoTurno = params.turns[params.turns.length - 1];

    if (ultimoTurno?.role === "user") {
      const matchTool = ultimoTurno.content.match(/^TOOL:([a-zA-Z0-9_]+):(.*)$/s);
      if (matchTool) {
        this.limparCadeia();
        const [, nomeTool, argsJson] = matchTool;
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

      const matchCadeia = ultimoTurno.content.match(/^CHAIN:(.*)$/s);
      if (matchCadeia) {
        const carregada = this.carregarCadeia(matchCadeia[1], params.turns);
        if ("erro" in carregada) {
          return { type: "text", text: `[mock] ${carregada.erro}` };
        }
        return this.emitirProximoPasso(params.tools);
      }

      this.limparCadeia();
      return {
        type: "text",
        text: `[mock] Você disse: "${ultimoTurno.content}". Para testar uma tool real, envie "TOOL:<nome>:<json>", ex: TOOL:listar_cursos:{}`,
      };
    }

    if (ultimoTurno?.role === "tool_results") {
      if (this.cadeia) {
        if (this.proximoPasso < this.cadeia.length) {
          return this.emitirProximoPasso(params.tools);
        }
        return this.responderReceita();
      }

      const resumo = ultimoTurno.results
        .map((r) => `Resultado de "${r.name}": ${JSON.stringify(r.result)}`)
        .join("\n");
      return { type: "text", text: `[mock] ${resumo}` };
    }

    return { type: "text", text: "[mock] (nada a responder)" };
  }

  private carregarCadeia(
    json: string,
    turns: ConversationTurn[]
  ): { ok: true } | { erro: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { erro: `JSON da cadeia inválido: ${json}` };
    }
    if (!Array.isArray(parsed)) {
      return { erro: "CHAIN espera um array JSON de {name, arguments}." };
    }

    const passos: PassoDaCadeia[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string") {
        return { erro: "Cada passo da cadeia precisa de {name, arguments}." };
      }
      const passo = item as { name: string; arguments?: unknown };
      const args =
        passo.arguments && typeof passo.arguments === "object" && !Array.isArray(passo.arguments)
          ? (passo.arguments as Record<string, unknown>)
          : {};
      passos.push({ name: passo.name, arguments: args });
    }

    this.cadeia = passos;
    this.proximoPasso = 0;
    this.textoPedidos = turns
      .filter((t): t is { role: "user"; content: string } => t.role === "user")
      .map((t) => t.content)
      .join("\n");
    return { ok: true };
  }

  private emitirProximoPasso(tools: ToolDefinition[]): LLMTurnResult {
    if (!this.cadeia || this.proximoPasso >= this.cadeia.length) {
      return this.responderReceita();
    }

    const passo = this.cadeia[this.proximoPasso];
    const id = `mock-chain-${this.proximoPasso}`;
    this.proximoPasso += 1;

    const toolExiste = tools.some((t) => t.name === passo.name);
    if (!toolExiste) {
      this.limparCadeia();
      return { type: "text", text: `[mock] Tool "${passo.name}" não existe nas tools disponíveis.` };
    }

    return {
      type: "tool_calls",
      toolCalls: [{ id, name: passo.name, arguments: passo.arguments }],
    };
  }

  private responderReceita(): LLMTurnResult {
    const semLactose = this.textoPedidos.toLowerCase().includes("sem lactose");
    const alergenos = semLactose
      ? "nenhum conhecido (receita sem lactose)"
      : "nenhum conhecido";

    const text = [
      "Nome: Mousse de chocolate",
      "Porções: 4",
      "Tempo: 25 min",
      "Ingredientes:",
      "- 200 g chocolate",
      "- 400 ml leite de coco",
      "Passos:",
      "1. Derreta o chocolate em banho-maria.",
      "2. Misture o leite de coco até ficar homogêneo.",
      "3. Leve à geladeira por 20 minutos.",
      `Alérgenos: ${alergenos}`,
      "Fora do catálogo: chocolate",
      "Curso relacionado: nenhum",
    ].join("\n");

    return { type: "text", text };
  }

  private limparCadeia(): void {
    this.cadeia = null;
    this.proximoPasso = 0;
    this.textoPedidos = "";
  }
}
