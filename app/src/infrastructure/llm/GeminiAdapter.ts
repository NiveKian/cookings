import type {
  ConversationTurn,
  LLMPort,
  LLMToolCall,
  LLMTurnResult,
  ToolDefinition,
} from "../../domain/ports/LLMPort";

// Adapter para a Gemini API (Google), usando fetch direto (sem SDK) para
// manter a dependência mínima. Implementa LLMPort — para trocar de
// provedor, ver infrastructure/llm/llmFactory.ts.
//
// NOTA: os nomes de modelo do Gemini mudam com frequência; ajuste
// GEMINI_MODEL no .env se o modelo padrão abaixo não estiver mais disponível.

interface GeminiPart {
  text?: string;
  functionCall?: { id?: string; name: string; args: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: unknown };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

// Remove campos do JSON Schema que a API do Gemini não aceita.
function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (["title", "additionalProperties", "$schema", "default"].includes(key)) continue;
      out[key] = sanitizeSchema(value);
    }
    return out;
  }
  return schema;
}

function turnsToGeminiContents(turns: ConversationTurn[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      contents.push({ role: "user", parts: [{ text: turn.content }] });
    } else if (turn.role === "assistant") {
      contents.push({ role: "model", parts: [{ text: turn.content }] });
    } else if (turn.role === "assistant_tool_calls") {
      contents.push({
        role: "model",
        parts: turn.toolCalls.map((tc) => ({ functionCall: { id: tc.id, name: tc.name, args: tc.arguments } })),
      });
    } else if (turn.role === "tool_results") {
      contents.push({
        role: "user",
        parts: turn.results.map((r) => ({ functionResponse: { id: r.toolCallId, name: r.name, response: r.result } })),
      });
    }
  }

  return contents;
}

export class GeminiAdapter implements LLMPort {
  readonly providerName = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = "gemini-flash-latest"
  ) {}

  async converse(params: {
    systemPrompt: string;
    turns: ConversationTurn[];
    tools: ToolDefinition[];
  }): Promise<LLMTurnResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      systemInstruction: { parts: [{ text: params.systemPrompt }] },
      contents: turnsToGeminiContents(params.turns),
      tools:
        params.tools.length > 0
          ? [
              {
                functionDeclarations: params.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: sanitizeSchema(t.inputSchema),
                })),
              },
            ]
          : undefined,
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const detalhe = await resp.text();
      throw new Error(`Gemini API respondeu ${resp.status}: ${detalhe}`);
    }

    const data = await resp.json();
    const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];

    const toolCalls: LLMToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: p.functionCall!.id ?? `gemini-call-${Date.now()}-${i}`,
        name: p.functionCall!.name,
        arguments: p.functionCall!.args ?? {},
      }));

    if (toolCalls.length > 0) {
      return { type: "tool_calls", toolCalls };
    }

    const texto = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("\n");

    return { type: "text", text: texto || "(sem resposta)" };
  }
}
