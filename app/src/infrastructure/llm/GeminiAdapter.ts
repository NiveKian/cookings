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
  // Exclusivo do Gemini 3.x: obrigatório ecoar de volta, sem alterar, em
  // toda parte de functionCall que o modelo tiver retornado com um. Em
  // chamadas paralelas, só a PRIMEIRA functionCall da resposta vem com
  // assinatura — as demais legitimamente não têm (ver wiki oficial:
  // https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures).
  thoughtSignature?: string;
  thought_signature?: string; // fallback defensivo, caso a API varie o casing
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

// Códigos transitórios: vale tentar de novo. Qualquer outro (400, 404...)
// é erro definitivo (payload errado, modelo errado) — não adianta repetir.
const RETRYABLE_STATUS = [429, 503];
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Remove campos do JSON Schema que a API do Gemini não aceita. Também
// resolve `$ref` locais (`#/$defs/Nome` e `#/definitions/Nome`) inlinando a
// definição, já que o Gemini rejeita `$ref` e `$defs`.
export function sanitizeSchema(schema: unknown): unknown {
  const root =
    schema && typeof schema === "object" && !Array.isArray(schema)
      ? (schema as Record<string, unknown>)
      : {};
  const defs: Record<string, unknown> = {
    ...((root.definitions as Record<string, unknown> | undefined) ?? {}),
    ...((root.$defs as Record<string, unknown> | undefined) ?? {}),
  };
  return resolveAndStrip(schema, defs, new Set());
}

function resolveAndStrip(node: unknown, defs: Record<string, unknown>, visiting: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((n) => resolveAndStrip(n, defs, visiting));
  if (!node || typeof node !== "object") return node;

  const obj = node as Record<string, unknown>;
  let base: Record<string, unknown> = {};
  let visited: string | undefined;

  if (typeof obj.$ref === "string") {
    const m = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(obj.$ref);
    const name = m?.[1];
    if (name && name in defs && !visiting.has(name)) {
      visited = name;
      visiting.add(name);
      const inlined = resolveAndStrip(defs[name], defs, visiting);
      if (inlined && typeof inlined === "object" && !Array.isArray(inlined)) {
        base = inlined as Record<string, unknown>;
      }
    } else {
      // Ref desconhecida ou cíclica: degrada para objeto genérico.
      base = { type: "object" };
    }
  }

  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(obj)) {
    if (["title", "additionalProperties", "$schema", "default", "$ref", "$defs", "definitions"].includes(key)) {
      continue;
    }
    out[key] = resolveAndStrip(value, defs, visiting);
  }
  if (visited) visiting.delete(visited);
  return out;
}

// O campo "response" do functionResponse do Gemini precisa ser um OBJETO
// JSON — nunca array, string ou número direto ("Proto field is not
// repeating, cannot start list" é o erro que a API dá se você mandar um
// array cru). Tools que retornam lista (ex: listar_cursos) ou valor
// primitivo precisam ser envelopadas antes de entrar no payload.
function wrapForGemini(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
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
        parts: turn.toolCalls.map((tc) => ({
          // Ecoa a assinatura tal como veio (undefined vira "sem campo" no
          // JSON — correto para as chamadas paralelas que não têm uma).
          thoughtSignature: tc.thoughtSignature,
          functionCall: { id: tc.id, name: tc.name, args: tc.arguments },
        })),
      });
    } else if (turn.role === "tool_results") {
      contents.push({
        role: "user",
        parts: turn.results.map((r) => ({
          functionResponse: { id: r.toolCallId, name: r.name, response: wrapForGemini(r.result) },
        })),
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

    let resp: Response | null = null;

    for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (resp.ok) break;

      const podeTentarDeNovo = RETRYABLE_STATUS.includes(resp.status) && tentativa < MAX_RETRIES;
      if (!podeTentarDeNovo) break;

      // backoff exponencial com jitter: ~500ms, ~1000ms, ~2000ms
      const esperaMs = 500 * 2 ** tentativa + Math.random() * 250;
      console.warn(
        `[gemini] ${resp.status} (tentativa ${tentativa + 1}/${MAX_RETRIES + 1}), aguardando ${Math.round(esperaMs)}ms...`
      );
      await sleep(esperaMs);
    }

    if (!resp) {
      throw new Error("Gemini API: nenhuma resposta obtida após as tentativas.");
    }

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
        thoughtSignature: p.thoughtSignature ?? p.thought_signature,
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