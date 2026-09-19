import type {
  ConversationTurn,
  LLMPort,
  LLMToolCall,
  LLMTurnResult,
  ToolDefinition,
} from "../../domain/ports/LLMPort";

import { ModelUnavailableError } from "../../domain/ports/LLMPort";

// Adapter para a Anthropic Messages API (Claude), via fetch direto.
// Implementa LLMPort — para trocar de provedor, ver
// infrastructure/llm/llmFactory.ts.

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface ClaudeMessage {
  role: "user" | "assistant";
  content: ClaudeContentBlock[];
}

function turnsToClaudeMessages(turns: ConversationTurn[]): ClaudeMessage[] {
  const messages: ClaudeMessage[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: [{ type: "text", text: turn.content }] });
    } else if (turn.role === "assistant") {
      messages.push({ role: "assistant", content: [{ type: "text", text: turn.content }] });
    } else if (turn.role === "assistant_tool_calls") {
      messages.push({
        role: "assistant",
        content: turn.toolCalls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        })),
      });
    } else if (turn.role === "tool_results") {
      messages.push({
        role: "user",
        content: turn.results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.toolCallId,
          content: JSON.stringify(r.result),
        })),
      });
    }
  }

  return messages;
}

export class ClaudeAdapter implements LLMPort {
  readonly providerName = "claude";
  private readonly models: string[];

  constructor(private readonly apiKey: string, models: string = "claude-sonnet-4-6") {
    // aceita lista separada por vírgula: "modelo-principal,modelo-fallback-1,modelo-fallback-2"
    this.models = models.split(",").map((m) => m.trim()).filter(Boolean);
  }

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    let lastError: Error | null = null;

    for (const model of this.models) {
      try {
        return await this.callModel(model, params);
      } catch (err) {
        if (err instanceof ModelUnavailableError) {
          console.warn(`[claude] "${model}" indisponível, tentando próximo da lista...`);
          lastError = err;
          continue; // tenta o próximo modelo da lista
        }
        throw err; // qualquer outro erro (auth, rate limit, rede) não deve tentar fallback
      }
    }

    throw lastError ?? new Error("Nenhum modelo Claude da lista está disponível.");
  }

  private async callModel(
    model: string,
    params: { systemPrompt: string; turns: ConversationTurn[]; tools: ToolDefinition[] }
  ): Promise<LLMTurnResult> {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: params.systemPrompt,
        messages: turnsToClaudeMessages(params.turns),
        tools: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
      }),
    });

    if (resp.status === 404) {
      throw new ModelUnavailableError(`Modelo Claude "${model}" não encontrado ou retirado.`);
    }
    if (!resp.ok) {
      const detalhe = await resp.text();
      throw new Error(`Claude API respondeu ${resp.status}: ${detalhe}`);
    }

    const data = await resp.json();
    const blocks: ClaudeContentBlock[] = data.content ?? [];

    const toolCalls: LLMToolCall[] = blocks
      .filter((b): b is Extract<ClaudeContentBlock, { type: "tool_use" }> => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, arguments: b.input }));

    if (toolCalls.length > 0) return { type: "tool_calls", toolCalls };

    const texto = blocks
      .filter((b): b is Extract<ClaudeContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return { type: "text", text: texto || "(sem resposta)" };
  }
}
