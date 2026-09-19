// Porta (interface) que qualquer provedor de LLM deve implementar.
// É esta porta que torna trivial trocar Gemini <-> Claude <-> GPT — ver
// infrastructure/llm/llmFactory.ts.

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (mesmo formato usado pelo protocolo MCP). */
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  /** ID gerado pelo provedor, usado para correlacionar o resultado da tool de volta a essa chamada. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Exclusivo do Gemini 3.x: assinatura opaca do estado de raciocínio do
   * modelo, que precisa ser devolvida sem alteração na próxima chamada.
   * Outros provedores (Claude, GPT) ignoram este campo.
   */
  thoughtSignature?: string;
}

export type LLMTurnResult =
  | { type: "text"; text: string }
  | { type: "tool_calls"; toolCalls: LLMToolCall[] };

/**
 * Representa um "turno" da conversa em um formato genérico, independente
 * de provedor. O adapter de cada LLM é responsável por converter esta
 * lista para o formato nativo da sua API a cada chamada.
 */
export type ConversationTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "assistant_tool_calls"; toolCalls: LLMToolCall[] }
  | { role: "tool_results"; results: Array<{ toolCallId: string; name: string; result: unknown }> };

export interface LLMPort {
  /** Nome do provedor, só para logs/debug (ex: "gemini", "claude", "gpt", "mock"). */
  readonly providerName: string;

  converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult>;
}