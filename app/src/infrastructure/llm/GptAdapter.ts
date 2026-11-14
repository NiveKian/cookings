import type {
  ConversationTurn,
  LLMPort,
  LLMToolCall,
  LLMTurnResult,
  ToolDefinition,
} from "../../domain/ports/LLMPort";
import { ModelUnavailableError } from "../../domain/ports/LLMPort";
import { parseModelList } from "./modelList";

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

// Códigos transitórios: vale tentar de novo. Qualquer outro (400, 401,
// 404...) é erro definitivo — não adianta repetir.
const RETRYABLE_STATUS = [429, 503];
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MODELO_PADRAO = "gpt-4o-mini";

export class GptAdapter implements LLMPort {
  readonly providerName = "gpt";
  private readonly models: string[];

  /**
   * @param models um modelo, ou vários separados por vírgula (ex.:
   * "modelo-principal,modelo-reserva"). Os reservas só são usados se o
   * anterior estiver indisponível (404) — ver converse().
   */
  constructor(private readonly apiKey: string, models?: string) {
    this.models = parseModelList(models, MODELO_PADRAO);
  }

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    let ultimoErro: ModelUnavailableError | null = null;

    for (const model of this.models) {
      try {
        return await this.callModel(model, params);
      } catch (err) {
        if (err instanceof ModelUnavailableError) {
          console.warn(`[gpt] ${err.message} Tentando o próximo modelo da lista...`);
          ultimoErro = err;
          continue;
        }
        // Qualquer outro erro (auth, rate limit esgotado, rede, payload)
        // não se resolve trocando de modelo — propaga.
        throw err;
      }
    }

    throw new Error(
      `OpenAI API: nenhum dos modelos configurados está disponível (${this.models.join(", ")}). ` +
        `Último erro: ${ultimoErro?.message ?? "desconhecido"}`
    );
  }

  private async callModel(
    model: string,
    params: { systemPrompt: string; turns: ConversationTurn[]; tools: ToolDefinition[] }
  ): Promise<LLMTurnResult> {
    const requestBody = JSON.stringify({
      model,
      messages: turnsToOpenAIMessages(params.systemPrompt, params.turns),
      tools: params.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),
    });

    let resp: Response | null = null;

    for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: requestBody,
      });

      if (resp.ok) break;

      const podeTentarDeNovo = RETRYABLE_STATUS.includes(resp.status) && tentativa < MAX_RETRIES;
      if (!podeTentarDeNovo) break;

      const esperaMs = 500 * 2 ** tentativa + Math.random() * 250;
      console.warn(
        `[gpt] ${resp.status} (tentativa ${tentativa + 1}/${MAX_RETRIES + 1}), aguardando ${Math.round(esperaMs)}ms...`
      );
      await sleep(esperaMs);
    }

    if (!resp) {
      throw new Error("OpenAI API: nenhuma resposta obtida após as tentativas.");
    }

    // 404 (model_not_found) = modelo inexistente, aposentado ou sem acesso
    // para esta chave: dá para tentar outro modelo da lista.
    if (resp.status === 404) {
      const detalhe = await resp.text();
      throw new ModelUnavailableError(`Modelo "${model}" indisponível (404): ${detalhe}`);
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

    if (toolCalls.length > 0) {
      return { type: "tool_calls", toolCalls };
    }

    return { type: "text", text: message.content || "(sem resposta)" };
  }
}
