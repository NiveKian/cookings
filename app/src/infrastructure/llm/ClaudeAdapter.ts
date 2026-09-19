import type {
  ConversationTurn,
  LLMPort,
  LLMToolCall,
  LLMTurnResult,
  ToolDefinition,
} from "../../domain/ports/LLMPort";

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

// Códigos transitórios: vale tentar de novo. Qualquer outro (400, 401,
// 404...) é erro definitivo — não adianta repetir.
const RETRYABLE_STATUS = [429, 503, 529]; // 529 = "overloaded_error" específico da Anthropic
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  constructor(
    private readonly apiKey: string,
    private readonly model: string = "claude-sonnet-4-5"
  ) {}

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    const requestBody = JSON.stringify({
      model: this.model,
      max_tokens: 1024,
      system: params.systemPrompt,
      messages: turnsToClaudeMessages(params.turns),
      tools: params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
    });

    let resp: Response | null = null;

    for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: requestBody,
      });

      if (resp.ok) break;

      const podeTentarDeNovo = RETRYABLE_STATUS.includes(resp.status) && tentativa < MAX_RETRIES;
      if (!podeTentarDeNovo) break;

      const esperaMs = 500 * 2 ** tentativa + Math.random() * 250;
      console.warn(
        `[claude] ${resp.status} (tentativa ${tentativa + 1}/${MAX_RETRIES + 1}), aguardando ${Math.round(esperaMs)}ms...`
      );
      await sleep(esperaMs);
    }

    if (!resp) {
      throw new Error("Claude API: nenhuma resposta obtida após as tentativas.");
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

    if (toolCalls.length > 0) {
      return { type: "tool_calls", toolCalls };
    }

    const texto = blocks
      .filter((b): b is Extract<ClaudeContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return { type: "text", text: texto || "(sem resposta)" };
  }
}