import type { ConversationTurn, LLMPort, LLMTurnResult, ToolDefinition } from "../../domain/ports/LLMPort";

// Adapter do Ollama só para o juiz. Não entra em llmFactory.ts (chat
// principal). Sem chave de API. POST {baseUrl}/api/chat com
// { model, messages, stream: false } — o campo tools nunca vai no JSON.
// O juiz manda tools: [] e só turnos user/assistant.

const BASE_URL_PADRAO = "http://127.0.0.1:11434";
const MODELO_PADRAO = "qwen2.5:1.5b";

interface MensagemOllama {
  role: "system" | "user" | "assistant";
  content: string;
}

export function urlSemBarraFinal(raw: string | undefined, padrao: string): string {
  const valor = raw?.trim() || padrao;
  return valor.replace(/\/+$/, "") || padrao;
}

function turnosParaMensagens(turns: ConversationTurn[]): MensagemOllama[] {
  const mensagens: MensagemOllama[] = [];
  let avisouTool = false;

  for (const turn of turns) {
    if (turn.role === "user" || turn.role === "assistant") {
      mensagens.push({ role: turn.role, content: turn.content });
      continue;
    }

    if (!avisouTool) {
      console.warn("[ollama] turno de tool ignorado; este adapter não suporta ferramentas.");
      avisouTool = true;
    }

    if (turn.role === "assistant_tool_calls") {
      mensagens.push({
        role: "assistant",
        content: "Tools não são suportadas por este adapter.",
      });
    } else {
      mensagens.push({
        role: "user",
        content: "Tools não são suportadas por este adapter.",
      });
    }
  }

  return mensagens;
}

function extrairContent(data: unknown): string {
  if (!data || typeof data !== "object") {
    throw new Error("Resposta do Ollama sem message.content.");
  }
  const message = (data as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    throw new Error("Resposta do Ollama sem message.content.");
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") {
    throw new Error("Resposta do Ollama sem message.content.");
  }
  return content;
}

export class OllamaAdapter implements LLMPort {
  readonly providerName = "ollama";
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(baseUrl: string = BASE_URL_PADRAO, model: string = MODELO_PADRAO) {
    this.baseUrl = urlSemBarraFinal(baseUrl, BASE_URL_PADRAO);
    this.model = model.trim() || MODELO_PADRAO;
  }

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    if (params.tools.length > 0) {
      console.warn(
        "[ollama] tools recebidas foram ignoradas; este adapter não chama ferramentas e não envia o campo tools."
      );
    }

    const url = `${this.baseUrl}/api/chat`;
    const body = {
      model: this.model,
      messages: [
        { role: "system" as const, content: params.systemPrompt },
        ...turnosParaMensagens(params.turns),
      ],
      stream: false as const,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Falha de rede ao chamar o Ollama (${url}): ${msg}`);
    }

    if (!response.ok) {
      let detalhe = "";
      try {
        detalhe = (await response.text()).trim();
      } catch {
        detalhe = "";
      }
      throw new Error(`Ollama respondeu HTTP ${response.status}${detalhe ? `: ${detalhe}` : ""}`);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Resposta do Ollama não é JSON (HTTP ${response.status}): ${msg}`);
    }

    return { type: "text", text: extrairContent(data) };
  }
}
