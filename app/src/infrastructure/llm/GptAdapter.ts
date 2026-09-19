import type {
  ConversationTurn,
  LLMPort,
  LLMToolCall,
  LLMTurnResult,
  ToolDefinition,
} from "../../domain/ports/LLMPort";

import { ModelUnavailableError } from "../../domain/ports/LLMPort";

// Adapter para a OpenAI Chat Completions API (GPT), via fetch direto.
// Implementa LLMPort — para trocar de provedor, ver
// infrastructure/llm/llmFactory.ts.

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

function turnsToOpenAIMessages(systemPrompt: string, turns: ConversationTurn[]): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [{ role: "system", content: systemPrompt }];

  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
    } else if (turn.role === "assistant") {
      messages.push({ role: "assistant", content: turn.content });
    } else if (turn.role === "assistant_tool_calls") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: turn.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else if (turn.role === "tool_results") {
      for (const r of turn.results) {
        messages.push({ role: "tool", tool_call_id: r.toolCallId, content: JSON.stringify(r.result) });
      }
    }
  }

  return messages;
}

export class GptAdapter implements LLMPort {
  readonly providerName = "gpt";
  private readonly models: string[];

  constructor(private readonly apiKey: string, models: string = "gpt-4o-mini") {
    this.models = models.split(",").map((m) => m.trim()).filter(Boolean);
  }

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    let ultimoErro: Error | null = null;

    for (const model of this.models) {
      try {
        return await this.callModel(model, params);
      } catch (err) {
        if (err instanceof ModelUnavailableError) {
          console.warn(`[gpt] "${model}" indisponível, tentando próximo da lista...`);
          ultimoErro = err;
          continue;
        }
        throw err;
      }
    }

    throw ultimoErro ?? new Error("Nenhum modelo GPT da lista está disponível.");
  }

  private async callModel(
    model: string,
    params: { systemPrompt: string; turns: ConversationTurn[]; tools: ToolDefinition[] }
  ): Promise<LLMTurnResult> {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model,
        messages: turnsToOpenAIMessages(params.systemPrompt, params.turns),
        tools: params.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
      }),
    });

    if (resp.status === 404) {
      const body = await resp.json().catch(() => null);
      throw new ModelUnavailableError(
        `Modelo GPT "${model}" indisponível (${body?.error?.code ?? "model_not_found"}).`
      );
    }
    if (!resp.ok) {
      const detalhe = await resp.text();
      throw new Error(`OpenAI API respondeu ${resp.status}: ${detalhe}`);
    }

    const data = await resp.json();
    const message = data?.choices?.[0]?.message ?? {};

    const toolCalls: LLMToolCall[] = (message.tool_calls ?? []).map((tc: OpenAIToolCall) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || "{}"),
    }));

    if (toolCalls.length > 0) return { type: "tool_calls", toolCalls };
    return { type: "text", text: message.content || "(sem resposta)" };
  }
}
